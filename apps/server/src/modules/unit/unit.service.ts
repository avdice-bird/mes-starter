import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { isPrismaUniqueViolation } from '../../common/filters/all-exceptions.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';
import { PageQueryDto } from '../../common/dto/page-query.dto';

/** 排序字段白名单：白名单外的 sortBy 回退默认，防任意字段排序 */
const UNIT_SORT_FIELDS = ['id', 'code', 'name', 'createdAt'] as const;

@Injectable()
export class UnitService {
  constructor(private prisma: PrismaService) {}

  async list(query: PageQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = UNIT_SORT_FIELDS.includes(query.sortBy as (typeof UNIT_SORT_FIELDS)[number])
      ? (query.sortBy as (typeof UNIT_SORT_FIELDS)[number])
      : 'id';
    const where = {
      isDeleted: false,
      ...(query.keyword
        ? { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }] }
        : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.unit.findMany({
        where,
        orderBy: { [sortBy]: query.sortOrder ?? 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { materials: { where: { isDeleted: false } } } } },
      }),
      this.prisma.unit.count({ where }),
    ]);
    return {
      list: list.map((u) => ({ ...u, materialCount: u._count.materials, _count: undefined })),
      total, page, pageSize,
    };
  }

  /** 下拉选项：登录即可（各业务页面的下拉都靠它），只返回启用单位 */
  async options() {
    const units = await this.prisma.unit.findMany({
      where: { isDeleted: false, status: 1 },
      orderBy: { id: 'asc' },
      select: { id: true, code: true, name: true },
    });
    return units;
  }

  async create(dto: CreateUnitDto, operator: string) {
    try {
      return await this.prisma.unit.create({ data: { ...dto, createdBy: operator, updatedBy: operator } });
    } catch (e) {
      if (isPrismaUniqueViolation(e, 'code')) {
        throw new BusinessException(ErrorCode.CONFLICT, `单位编码 ${dto.code} 已存在`);
      }
      throw e;
    }
  }

  /** code 被物料引用：不可修改（Update DTO 不收 code，Service 兜底） */
  async update(id: number, dto: UpdateUnitDto, operator: string) {
    const unit = await this.prisma.unit.findFirst({ where: { id, isDeleted: false } });
    if (!unit) throw new BusinessException(ErrorCode.NOT_FOUND, '单位不存在');
    return this.prisma.unit.update({
      where: { id },
      data: { name: dto.name, status: dto.status, updatedBy: operator },
    });
  }

  /** 删除被物料引用的单位 → 409 + 提示物料数 */
  async remove(id: number) {
    const unit = await this.prisma.unit.findFirst({
      where: { id, isDeleted: false },
      include: { _count: { select: { materials: { where: { isDeleted: false } } } } },
    });
    if (!unit) throw new BusinessException(ErrorCode.NOT_FOUND, '单位不存在');
    if (unit._count.materials > 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该单位被 ${unit._count.materials} 个物料引用，请先调整这些物料的单位`,
      );
    }
    await this.prisma.unit.update({ where: { id }, data: { isDeleted: true, updatedBy: 'system' } });
  }
}
