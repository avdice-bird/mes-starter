import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { isPrismaUniqueViolation } from '../../common/filters/all-exceptions.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { BomExplodeService } from '../bom/bom-explode.service';
import { RoutingService } from '../routing/routing.service';
import { CreateMaterialDto, QueryMaterialDto, UpdateMaterialDto } from './dto/material.dto';
import {
  IMPORT_HEADERS, ImportRow, MATERIAL_TYPE_LABELS,
  normalizeType, RowError, validateImportRows,
} from './import-validate';

/** 排序字段白名单 */
const MATERIAL_SORT_FIELDS = ['id', 'code', 'name', 'type', 'createdAt'] as const;

/** 导入单批上限：5000 行（任务卡 14 用例 8 的量级），超出直接拒绝 */
const IMPORT_MAX_ROWS = 5000;

@Injectable()
export class MaterialService {
  constructor(
    private prisma: PrismaService,
    private explode: BomExplodeService,
    private routings: RoutingService,
  ) {}

  async list(query: QueryMaterialDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = MATERIAL_SORT_FIELDS.includes(query.sortBy as (typeof MATERIAL_SORT_FIELDS)[number])
      ? (query.sortBy as (typeof MATERIAL_SORT_FIELDS)[number])
      : 'id';
    const where = {
      isDeleted: false,
      ...(query.keyword
        ? { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }, { spec: { contains: query.keyword } }] }
        : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.material.findMany({
        where,
        orderBy: { [sortBy]: query.sortOrder ?? 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: { select: { id: true, code: true, name: true } }, unit: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.material.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async findOne(id: number) {
    const material = await this.prisma.material.findFirst({
      where: { id, isDeleted: false },
      include: { category: true, unit: true },
    });
    if (!material) throw new BusinessException(ErrorCode.NOT_FOUND, '物料不存在');
    return material;
  }

  async create(dto: CreateMaterialDto, operator: string) {
    await this.assertRefs(dto.categoryId, dto.unitId);
    try {
      return await this.prisma.material.create({
        data: { ...dto, createdBy: operator, updatedBy: operator },
      });
    } catch (e) {
      if (isPrismaUniqueViolation(e, 'code')) {
        throw new BusinessException(ErrorCode.CONFLICT, `物料编码 ${dto.code} 已存在`);
      }
      throw e;
    }
  }

  /** code 创建后不可修改：Update DTO 不收 code，Service 兜底忽略 */
  async update(id: number, dto: UpdateMaterialDto, operator: string) {
    const material = await this.prisma.material.findFirst({ where: { id, isDeleted: false } });
    if (!material) throw new BusinessException(ErrorCode.NOT_FOUND, '物料不存在');
    if (dto.categoryId !== undefined) await this.assertCategory(dto.categoryId);
    if (dto.unitId !== undefined) await this.assertUnit(dto.unitId);
    return this.prisma.material.update({
      where: { id },
      data: { ...dto, updatedBy: operator },
    });
  }

  /**
   * 删除被 BOM/工单/库存引用的物料 → 拒绝。
   * BOM 第 16 节才建：现在先删 BOM 引用检查（留空实现点），有子引用的表做完后在这里补。
   */
  async remove(id: number) {
    const material = await this.prisma.material.findFirst({ where: { id, isDeleted: false } });
    if (!material) throw new BusinessException(ErrorCode.NOT_FOUND, '物料不存在');
    // 引用检查（第 21 节用例 12）：被 BOM（父或子）、工艺路线引用 → 409；工单/库存等后续模块出现后在此追加
    const bomAsParent = await this.prisma.bom.count({ where: { materialId: id, status: { not: 'OBSOLETE' } } });
    if (bomAsParent > 0) {
      throw new BusinessException(ErrorCode.CONFLICT, `物料被 ${bomAsParent} 个 BOM 作为父物料引用，不能删除`);
    }
    const bomAsChild = await this.prisma.bomItem.count({ where: { childMaterialId: id, bom: { status: { not: 'OBSOLETE' } } } });
    if (bomAsChild > 0) {
      throw new BusinessException(ErrorCode.CONFLICT, `物料被 ${bomAsChild} 条 BOM 明细引用，不能删除`);
    }
    const asRoutingParent = await this.prisma.routing.count({ where: { materialId: id, status: { not: 'OBSOLETE' } } });
    if (asRoutingParent > 0) {
      throw new BusinessException(ErrorCode.CONFLICT, `物料被 ${asRoutingParent} 条工艺路线引用，不能删除`);
    }
    await this.prisma.material.update({ where: { id }, data: { isDeleted: true, updatedBy: 'system' } });
  }

  private async assertRefs(categoryId: number, unitId: number) {
    await this.assertCategory(categoryId);
    await this.assertUnit(unitId);
  }

  private async assertCategory(categoryId: number) {
    const category = await this.prisma.materialCategory.findFirst({ where: { id: categoryId, isDeleted: false } });
    if (!category) throw new BusinessException(ErrorCode.NOT_FOUND, '物料分类不存在');
  }

  private async assertUnit(unitId: number) {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, isDeleted: false } });
    if (!unit) throw new BusinessException(ErrorCode.NOT_FOUND, '单位不存在');
  }

  // ==================== 导入导出 ====================

  /** 下载导入模板：表头 + 示例行 + 类型说明 sheet */
  async buildTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('物料');
    ws.addRow([...IMPORT_HEADERS]);
    ws.addRow(['CAP-0402-104', '贴片电容 100nF', '0402 X7R ±10% 50V', 'CAP', 'PCS', '原料', '1000']);
    ws.getRow(1).font = { bold: true };
    const note = wb.addWorksheet('填写说明');
    note.addRow(['类型可选值：原料 / 半成品 / 成品（或 RAW / SEMI / FINISHED）']);
    note.addRow(['分类编码、单位编码必须已存在（先在对应页面创建）']);
    note.addRow(['安全库存为可选，填非负整数']);
    note.addRow(['请勿修改表头名称；列顺序可以调整，系统按表头名识别']);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /**
   * 导入：先校验全部行，有任何错误整批拒绝（不写入），返回错误报告供下载。
   * 校验通过：一条 $transaction 批量写入。
   */
  async import(file: Express.Multer.File | undefined, operator: string): Promise<{ successCount: number; errorCount: number; errors: RowError[] }> {
    if (!file?.buffer?.length) throw new BusinessException(ErrorCode.VALIDATION, '请上传 xlsx 文件');

    // 用例 9：不是 xlsx（改名的 txt）→ 400 友好提示。zip 魔数 PK\x03\x04
    const magic = file.buffer.subarray(0, 4);
    const isZipMagic = magic[0] === 0x50 && magic[1] === 0x4b && (magic[2] === 0x03 || magic[2] === 0x05 || magic[2] === 0x07);
    if (!isZipMagic) {
      throw new BusinessException(ErrorCode.VALIDATION, '文件不是有效的 xlsx（Excel 工作簿），请勿直接改文件扩展名');
    }

    const rows = await this.parseImportRows(file.buffer);
    if (rows.length === 0) {
      throw new BusinessException(ErrorCode.VALIDATION, '未解析到任何数据行：请确认首个工作表有数据且表头为标准模板');
    }
    if (rows.length > IMPORT_MAX_ROWS) {
      throw new BusinessException(ErrorCode.VALIDATION, `单次导入最多 ${IMPORT_MAX_ROWS} 行，当前 ${rows.length} 行，请分批导入`);
    }

    const [units, categories, materials] = await Promise.all([
      this.prisma.unit.findMany({ where: { isDeleted: false }, select: { id: true, code: true } }),
      this.prisma.materialCategory.findMany({ where: { isDeleted: false }, select: { id: true, code: true } }),
      this.prisma.material.findMany({ where: { isDeleted: false }, select: { code: true } }),
    ]);
    const ref = {
      unitCodes: new Set(units.map((u) => u.code)),
      categoryCodes: new Set(categories.map((c) => c.code)),
      existingMaterialCodes: new Set(materials.map((m) => m.code)),
      unitIds: new Map(units.map((u) => [u.code, u.id])),
      categoryIds: new Map(categories.map((c) => [c.code, c.id])),
    };

    const errors = validateImportRows(rows, ref);
    if (errors.length > 0) {
      // 整批拒绝：返回错误明细（Service 层生成错误报告 buffer，Controller 直接下载）
      return { successCount: 0, errorCount: errors.length, errors };
    }

    // 校验全过：批量写入。单条事务保证失败回滚；
    // categoryIds/unitIds 的 get 断言非空——validateImportRows 已确保编码存在于参照集
    await this.prisma.$transaction(
      rows.map((row) => {
        const categoryId = ref.categoryIds.get(row.categoryCode);
        const unitId = ref.unitIds.get(row.unitCode);
        if (categoryId == null || unitId == null) {
          throw new BusinessException(ErrorCode.VALIDATION, `第 ${row.rowNumber} 行的分类或单位在写入时丢失，请重试`);
        }
        return this.prisma.material.create({
          data: {
            code: row.code,
            name: row.name,
            spec: row.spec || null,
            categoryId,
            unitId,
            type: normalizeType(row.type),
            safetyStock: row.safetyStock ? Number(row.safetyStock) : null,
            createdBy: operator,
            updatedBy: operator,
          },
        });
      }),
    );
    return { successCount: rows.length, errorCount: 0, errors: [] };
  }

  /** 解析 xlsx：按表头名取列；跳过空行；保留原行号 */
  private async parseImportRows(buffer: Buffer): Promise<ImportRow[]> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('文件解析失败：不是有效的 xlsx（Excel 工作簿）');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BusinessException(ErrorCode.VALIDATION, '工作簿为空');

    // 表头行 → 列号映射（按表头名识别，容忍列顺序打乱/多列）
    const headerRow = ws.getRow(1);
    const colByHeader = new Map<string, number>();
    headerRow.eachCell((cell, colNumber) => {
      const text = String(cell.value ?? '').trim();
      if ((IMPORT_HEADERS as readonly string[]).includes(text)) colByHeader.set(text, colNumber);
    });
    const missing = (IMPORT_HEADERS as readonly string[]).filter((h) => !colByHeader.has(h) && h !== '安全库存' && h !== '规格型号');
    if (missing.length > 0) {
      throw new BusinessException(ErrorCode.VALIDATION, `缺少必需列：${missing.join('、')}`);
    }

    const cellText = (row: ExcelJS.Row, header: string): string => {
      const col = colByHeader.get(header);
      if (!col) return '';
      const v = row.getCell(col).value;
      if (v == null) return '';
      if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: string }).text).trim();
      if (typeof v === 'object' && 'result' in (v as object)) return String((v as { result: unknown }).result ?? '').trim();
      return String(v).trim();
    };

    const rows: ImportRow[] = [];
    const isEmptyRow = (row: ExcelJS.Row) =>
      [...colByHeader.values()].every((col) => {
        const v = row.getCell(col).value;
        return v == null || String(typeof v === 'object' && 'text' in (v as object) ? (v as { text: string }).text : v).trim() === '';
      });

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // 表头
      if (isEmptyRow(row)) return; // 用例 3：空行跳过，不报错
      rows.push({
        rowNumber,
        code: cellText(row, '物料编码'),
        name: cellText(row, '物料名称'),
        spec: cellText(row, '规格型号'),
        categoryCode: cellText(row, '分类编码'),
        unitCode: cellText(row, '单位编码'),
        type: cellText(row, '类型'),
        safetyStock: cellText(row, '安全库存'),
      });
    });
    return rows;
  }

  /** 错误报告：原行 + 错误原因列（红色标记）；有错误时随导入响应下载 */
  async buildErrorReport(errors: RowError[], failedRows: ImportRow[]): Promise<Buffer> {
    const rowByNumber = new Map(failedRows.map((r) => [r.rowNumber, r]));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('导入错误');
    ws.addRow([...IMPORT_HEADERS, '错误原因']);
    for (const err of errors) {
      const row = rowByNumber.get(err.rowNumber);
      ws.addRow([
        row?.code ?? '', row?.name ?? '', row?.spec ?? '', row?.categoryCode ?? '', row?.unitCode ?? '',
        row?.type ?? '', row?.safetyStock ?? '',
        `第 ${err.rowNumber} 行：${err.message}`,
      ]);
    }
    const header = ws.getRow(1);
    header.font = { bold: true };
    const errCol = ws.getColumn(8);
    errCol.font = { color: { argb: 'FFCC0000' }, bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** 按当前筛选条件导出（与列表同一 where，复用 list 的过滤参数） */
  async export(query: QueryMaterialDto): Promise<Buffer> {
    const where = {
      isDeleted: false,
      ...(query.keyword
        ? { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }, { spec: { contains: query.keyword } }] }
        : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
    };
    const materials = await this.prisma.material.findMany({
      where,
      orderBy: { id: 'asc' },
      include: { category: { select: { code: true, name: true } }, unit: { select: { code: true, name: true } } },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('物料');
    ws.addRow([...IMPORT_HEADERS]);
    ws.getRow(1).font = { bold: true };
    for (const m of materials) {
      ws.addRow([
        m.code, m.name, m.spec ?? '', m.category.code, m.unit.code,
        MATERIAL_TYPE_LABELS[m.type] ?? m.type, m.safetyStock?.toString() ?? '',
      ]);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** 当前生效 BOM 的叶子需求汇总（M2 验收用；explode=1 时展开多级） */
  async activeBomSummary(materialId: number, explode: boolean, qty: number) {
    const material = await this.prisma.material.findFirst({ where: { id: materialId, isDeleted: false } });
    if (!material) throw new BusinessException(ErrorCode.NOT_FOUND, '物料不存在');
    const active = await this.prisma.bom.findFirst({ where: { materialId, status: 'ACTIVE' } });
    if (!active) throw new BusinessException(ErrorCode.NOT_FOUND, `物料 ${material.code} 没有生效中的 BOM`);
    if (!explode) {
      const detail = await this.prisma.bom.findUnique({ where: { id: active.id }, include: { items: true } });
      return {
        bom: { id: active.id, version: active.version },
        summary: detail!.items.map((it) => ({ materialId: it.childMaterialId, qty: it.qty })),
      };
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const graph = await this.explode.loadGraph(tx);
      // 确保根物料在图里（DRAFT 不可用，ACTIVE 必在）
      const bomDetail = await tx.bom.findUnique({
        where: { id: active.id },
        include: { items: { select: { childMaterialId: true, qty: true, scrapRate: true } }, material: true },
      });
      graph.byMaterial.set(active.materialId, {
        materialId: active.materialId, bomId: active.id,
        items: bomDetail!.items.map((it) => ({ childMaterialId: it.childMaterialId, qty: it.qty, scrapRate: it.scrapRate })),
      });
      const materials = await tx.material.findMany({ select: { id: true, code: true, name: true, type: true } });
      const matMap = new Map(materials.map((m) => [m.id, m]));
      const r = this.explode.explodeFromBom(
        graph,
        { id: active.id, materialId: active.materialId, items: bomDetail!.items },
        matMap, qty,
      );
      return { bom: { id: active.id, version: active.version }, summary: r.summary };
    });
    return result;
  }

  /** 当前生效工艺路线（M2 验收用，工序按 seq 排序） */
  async activeRouting(materialId: number) {
    const material = await this.prisma.material.findFirst({ where: { id: materialId, isDeleted: false } });
    if (!material) throw new BusinessException(ErrorCode.NOT_FOUND, '物料不存在');
    return this.routings.findActiveByMaterial(materialId);
  }
}
