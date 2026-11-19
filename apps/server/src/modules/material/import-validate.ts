/**
 * 物料导入校验：纯函数（输入行数组与参照数据，输出错误列表），不碰 Prisma、不碰 HTTP。
 * 抽成纯函数的原因（第 15 节）：单测直接喂行数组即可覆盖全部边界，不用起应用、不用 mock。
 *
 * 部分失败策略（第 14 节决定，docs/log/14.md 有完整理由）：
 * 先校验全部行，有任何错误就整批拒绝（不写入一行），返回错误报告；用户修完再传。
 * 理由：物料被 BOM/库存引用，导入一半的"半批数据"会让下游单据引用残缺主数据；
 * 200 条的量全批重传成本可忽略。
 */

/** 导入行：Excel 按表头名取值（不按列序，表头顺序打乱/多列都能识别） */
export interface ImportRow {
  rowNumber: number; // Excel 里的实际行号（含表头偏移），报错定位用
  code: string;
  name: string;
  spec: string;
  categoryCode: string;
  unitCode: string;
  type: string;
  safetyStock: string;
}

export interface RowError {
  rowNumber: number;
  /** 错误原因（可拼接多条，写入错误报告的"错误原因"列） */
  message: string;
}

/** 参照数据：调用方（Service）查库后传入，保持纯函数 */
export interface RefData {
  unitCodes: Set<string>;
  categoryCodes: Set<string>;
  existingMaterialCodes: Set<string>;
}

export const MATERIAL_TYPES = ['RAW', 'SEMI', 'FINISHED'] as const;
export const MATERIAL_TYPE_LABELS: Record<string, string> = {
  RAW: '原料',
  SEMI: '半成品',
  FINISHED: '成品',
};

/** code 正则：字母开头，2-32 位字母数字下划线连字符（与 Material DTO 一致） */
const CODE_RE = /^[A-Za-z][A-Za-z0-9_-]{1,31}$/;

/** 全角字符（含全角数字/字母）检测：全角提示错误而不是静默转换 */
const FULLWIDTH_RE = /[\uFF01-\uFF5E\u3000\u3001\u3008-\u3011]/;

/** 表头名 → 字段（按表头名识别列，不按列序） */
export const IMPORT_HEADERS = ['物料编码', '物料名称', '规格型号', '分类编码', '单位编码', '类型', '安全库存'] as const;

/** 校验全部行。空行已在解析阶段跳过（rowNumber 保留原行号，不占错误）。 */
export function validateImportRows(rows: ImportRow[], ref: RefData): RowError[] {
  const errors: RowError[] = [];
  const codeRowNumbers = new Map<string, number[]>(); // 文件内编码 → 出现行号列表
  const seenCodes = new Set<string>();

  for (const row of rows) {
    const rowErrors: string[] = [];

    // --- 编码 ---
    if (!row.code) {
      rowErrors.push('物料编码不能为空');
    } else if (FULLWIDTH_RE.test(row.code)) {
      rowErrors.push('物料编码含全角字符，请改为半角后重试');
    } else if (CODE_RE.test(row.code)) {
      if (seenCodes.has(row.code)) {
        // 同码再次出现时，把首次出现行也一起指出
        const first = codeRowNumbers.get(row.code) ?? [];
        codeRowNumbers.set(row.code, [...first, row.rowNumber]);
      } else {
        seenCodes.add(row.code);
        codeRowNumbers.set(row.code, [row.rowNumber]);
      }
    } else {
      rowErrors.push('物料编码须为 2-32 位字母开头的字母数字、下划线或连字符');
    }

    // --- 名称 ---
    if (!row.name) rowErrors.push('物料名称不能为空（必填列缺失）');
    else if (row.name.length > 64) rowErrors.push('物料名称不能超过 64 字');

    // --- 规格（可选）---
    if (row.spec && row.spec.length > 128) rowErrors.push('规格型号不能超过 128 字');

    // --- 分类 ---
    if (!row.categoryCode) rowErrors.push('分类编码不能为空');
    else if (!ref.categoryCodes.has(row.categoryCode)) {
      rowErrors.push(`分类编码 ${row.categoryCode} 不存在，请先在物料分类中创建`);
    }

    // --- 单位 ---
    if (!row.unitCode) rowErrors.push('单位编码不能为空');
    else if (!ref.unitCodes.has(row.unitCode)) {
      rowErrors.push(`单位编码 ${row.unitCode} 不存在，请先在计量单位中创建`);
    }

    // --- 类型 ---
    if (!row.type) {
      rowErrors.push(`类型不能为空，可选值：${Object.values(MATERIAL_TYPE_LABELS).join('/')}`);
    } else if (!isKnownTypeLabel(row.type)) {
      rowErrors.push(`类型「${row.type}」无效，可选值：${Object.values(MATERIAL_TYPE_LABELS).join('/')}`);
    }

    // --- 安全库存（可选，非负整数）---
    if (row.safetyStock && !/^\d+$/.test(row.safetyStock)) {
      rowErrors.push('安全库存须为非负整数');
    }

    if (rowErrors.length > 0) errors.push({ rowNumber: row.rowNumber, message: rowErrors.join('；') });
  }

  // 文件内重复编码：所有涉及行都报错，并互相指认行号
  for (const [, lineNos] of codeRowNumbers) {
    if (lineNos.length > 1) {
      const others = (n: number) => lineNos.filter((x) => x !== n).join('、');
      for (const n of lineNos) {
        errors.push({ rowNumber: n, message: `物料编码与第 ${others(n)} 行重复` });
      }
    }
  }

  // 与库中已有重复（整批拒绝策略：报错，不更新）
  for (const row of rows) {
    if (row.code && ref.existingMaterialCodes.has(row.code) && seenCodes.has(row.code)) {
      errors.push({ rowNumber: row.rowNumber, message: `物料编码 ${row.code} 已存在于系统中，请修改编码（导入不覆盖已有数据）` });
    }
  }

  return errors.sort((a, b) => a.rowNumber - b.rowNumber);
}

/** 类型列兼容"RAW/SEMI/FINISHED"与中文标签两种写法 */
export function isKnownTypeLabel(raw: string): boolean {
  const v = raw.trim();
  return (MATERIAL_TYPES as readonly string[]).includes(v) || Object.values(MATERIAL_TYPE_LABELS).includes(v);
}

/** 中文标签 → 枚举值（RAW/SEMI/FINISHED 原样返回）；未知值原样返回，由校验层拦截 */
export function normalizeType(raw: string): string {
  const v = raw.trim();
  if ((MATERIAL_TYPES as readonly string[]).includes(v)) return v;
  const entry = Object.entries(MATERIAL_TYPE_LABELS).find(([, label]) => label === v);
  return entry ? entry[0] : v;
}
