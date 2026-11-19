import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkCenterDto, UpdateWorkCenterDto } from './dto/work-center.dto';

@Injectable()
export class WorkCenterService {
  constructor(private prisma: PrismaService) {}

  async list(query: { page?: number; pageSize?: number; keyword?: string }) {
    // @Query() 裸对象里 page/pageSize 是字符串（ValidationPipe 不经过非 DTO 参数），必须显式转换
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where: Prisma.WorkCenterWhereInput = query.keyword
      ? { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }] }
      : {};
    const [list, total] = await this.prisma.$transaction([
      this.prisma.workCenter.findMany({
        where, orderBy: { id: 'asc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { _count: { select: { equipments: true, operations: true } } },
      }),
      this.prisma.workCenter.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async create(dto: CreateWorkCenterDto, operator: string) {
    try {
      return await this.prisma.workCenter.create({ data: { ...dto, createdBy: operator, updatedBy: operator } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new BusinessException(ErrorCode.CONFLICT, `工作中心编码 ${dto.code} 已存在`);
      throw e;
    }
  }

  async update(id: number, dto: UpdateWorkCenterDto, operator: string) {
    const wc = await this.prisma.workCenter.findUnique({ where: { id } });
    if (!wc) throw new BusinessException(ErrorCode.NOT_FOUND, '工作中心不存在');
    return this.prisma.workCenter.update({ where: { id }, data: { ...dto, updatedBy: operator } });
  }

  /** 有设备或被工序引用 → 409（第 21 节用例 6/7） */
  async remove(id: number) {
    const wc = await this.prisma.workCenter.findUnique({
      where: { id },
      include: { _count: { select: { equipments: true, operations: true } } },
    });
    if (!wc) throw new BusinessException(ErrorCode.NOT_FOUND, '工作中心不存在');
    if (wc._count.equipments > 0) {
      throw new BusinessException(ErrorCode.CONFLICT, `该工作中心下有 ${wc._count.equipments} 台设备，请先转移或删除`);
    }
    if (wc._count.operations > 0) {
      throw new BusinessException(ErrorCode.CONFLICT, `该工作中心被 ${wc._count.operations} 道工序引用，不能删除`);
    }
    await this.prisma.workCenter.delete({ where: { id } });
  }
}
