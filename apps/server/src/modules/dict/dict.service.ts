import { Injectable } from '@nestjs/common';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDictDto, UpdateDictDto } from './dto/dict.dto';
import { CreateDictItemDto, UpdateDictItemDto } from './dto/dict-item.dto';
import { PageQueryDto } from '../../common/dto/page-query.dto';

/** 排序字段白名单：防止 sortBy 任意取值（虽然走 Prisma 不拼 SQL，白名单仍让行为可预期） */
const DICT_SORT_FIELDS = ['id', 'code', 'name', 'createdAt'] as const;

@Injectable()
export class DictService {
  constructor(private prisma: PrismaService) {}

  async list(query: PageQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = DICT_SORT_FIELDS.includes(query.sortBy as (typeof DICT_SORT_FIELDS)[number])
      ? (query.sortBy as (typeof DICT_SORT_FIELDS)[number])
      : 'id';
    const where = query.keyword
      ? { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }] }
      : {};
    const [list, total] = await this.prisma.$transaction([
      this.prisma.dict.findMany({
        where,
        orderBy: { [sortBy]: query.sortOrder ?? 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.dict.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async findOne(id: number) {
    const dict = await this.prisma.dict.findUnique({ where: { id }, include: { items: { orderBy: { sort: 'asc' } } } });
    if (!dict) throw new BusinessException(ErrorCode.NOT_FOUND, '字典不存在');
    return dict;
  }

  /** 按编码取启用字典项（下拉用；只要求登录——所有业务页面的下拉都靠它） */
  async optionsByCode(code: string) {
    const dict = await this.prisma.dict.findUnique({ where: { code } });
    if (!dict) return [];
    const items = await this.prisma.dictItem.findMany({
      where: { dictId: dict.id, status: 1 },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    return items.map((it) => ({ label: it.label, value: it.value }));
  }

  async create(dto: CreateDictDto, operator: string) {
    return this.prisma.dict.create({ data: { ...dto, createdBy: operator, updatedBy: operator } });
  }

  /** code 被业务代码引用：拒绝修改（DTO 层不收 code，Service 再兜底防误用） */
  async update(id: number, dto: UpdateDictDto, operator: string) {
    const dict = await this.prisma.dict.findUnique({ where: { id } });
    if (!dict) throw new BusinessException(ErrorCode.NOT_FOUND, '字典不存在');
    return this.prisma.dict.update({
      where: { id },
      data: { name: dto.name, remark: dto.remark, updatedBy: operator },
    });
  }

  /** 删除有字典项的字典 → 拒绝，提示项数 */
  async remove(id: number) {
    const dict = await this.prisma.dict.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
    if (!dict) throw new BusinessException(ErrorCode.NOT_FOUND, '字典不存在');
    if (dict._count.items > 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该字典下有 ${dict._count.items} 个字典项，请先清空再删除`,
      );
    }
    await this.prisma.dict.delete({ where: { id } });
  }

  /** 字典项列表（字典存在性校验 + 按 sort 排序） */
  async listItems(dictId: number) {
    const dict = await this.prisma.dict.findUnique({ where: { id: dictId } });
    if (!dict) throw new BusinessException(ErrorCode.NOT_FOUND, '字典不存在');
    return this.prisma.dictItem.findMany({ where: { dictId }, orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
  }

  async createItem(dictId: number, dto: CreateDictItemDto, operator: string) {
    const dict = await this.prisma.dict.findUnique({ where: { id: dictId } });
    if (!dict) throw new BusinessException(ErrorCode.NOT_FOUND, '字典不存在');
    try {
      return await this.prisma.dictItem.create({
        data: { ...dto, dictId, createdBy: operator, updatedBy: operator },
      });
    } catch (e) {
      // @@unique([dictId, value]) 冲突 → 409 友好提示
      if ((e as { code?: string }).code === 'P2002') {
        throw new BusinessException(ErrorCode.CONFLICT, '该字典下已存在相同 value 的字典项');
      }
      throw e;
    }
  }

  async updateItem(id: number, dto: UpdateDictItemDto, operator: string) {
    const item = await this.prisma.dictItem.findUnique({ where: { id } });
    if (!item) throw new BusinessException(ErrorCode.NOT_FOUND, '字典项不存在');
    try {
      return await this.prisma.dictItem.update({ where: { id }, data: { ...dto, updatedBy: operator } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new BusinessException(ErrorCode.CONFLICT, '该字典下已存在相同 value 的字典项');
      }
      throw e;
    }
  }

  async removeItem(id: number) {
    const item = await this.prisma.dictItem.findUnique({ where: { id } });
    if (!item) throw new BusinessException(ErrorCode.NOT_FOUND, '字典项不存在');
    await this.prisma.dictItem.delete({ where: { id } });
  }
}
