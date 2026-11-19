import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEquipmentDto, UpdateEquipmentDto } from './dto/equipment.dto';

@Injectable()
export class EquipmentService {
  constructor(private prisma: PrismaService) {}

  async list(query: { page?: number; pageSize?: number; keyword?: string; workCenterId?: number }) {
    // @Query() 裸对象里数值参数是字符串，显式转换（workCenterId 同理）
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const wcId = Number(query.workCenterId);
    const where: Prisma.EquipmentWhereInput = {
      ...(wcId > 0 ? { workCenterId: wcId } : {}),
      ...(query.keyword && { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }] }),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.equipment.findMany({
        where, orderBy: { id: 'asc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: { workCenter: { select: { code: true, name: true } } },
      }),
      this.prisma.equipment.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async create(dto: CreateEquipmentDto, operator: string) {
    await this.assertWorkCenter(dto.workCenterId);
    try {
      return await this.prisma.equipment.create({ data: { ...dto, createdBy: operator, updatedBy: operator } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new BusinessException(ErrorCode.CONFLICT, `设备编码 ${dto.code} 已存在`);
      throw e;
    }
  }

  async update(id: number, dto: UpdateEquipmentDto, operator: string) {
    const eq = await this.prisma.equipment.findUnique({ where: { id } });
    if (!eq) throw new BusinessException(ErrorCode.NOT_FOUND, '设备不存在');
    if (dto.workCenterId && dto.workCenterId !== eq.workCenterId) {
      await this.assertWorkCenter(dto.workCenterId);
      // 转移工作中心：审计拦截器自动记录 PATCH 请求（第 21 节用例 8）
    }
    return this.prisma.equipment.update({ where: { id }, data: { ...dto, updatedBy: operator } });
  }

  async remove(id: number) {
    const eq = await this.prisma.equipment.findUnique({ where: { id } });
    if (!eq) throw new BusinessException(ErrorCode.NOT_FOUND, '设备不存在');
    await this.prisma.equipment.delete({ where: { id } });
  }

  private async assertWorkCenter(id: number) {
    const wc = await this.prisma.workCenter.findUnique({ where: { id } });
    if (!wc) throw new BusinessException(ErrorCode.NOT_FOUND, '工作中心不存在');
    if (wc.status !== 1) throw new BusinessException(ErrorCode.STATE_NOT_ALLOWED, '工作中心已停用');
  }
}
