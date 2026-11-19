import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryAuditLogDto } from './dto/audit-log.dto';

const SORT_FIELDS = ['id', 'createdAt', 'durationMs'] as const;

/** 审计日志查询服务：只读，无删除接口（审计不可篡改） */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async list(query: QueryAuditLogDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sortBy = SORT_FIELDS.includes(query.sortBy as (typeof SORT_FIELDS)[number])
      ? (query.sortBy as (typeof SORT_FIELDS)[number])
      : 'id';
    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.module ? { module: query.module } : {}),
      ...(query.result ? { result: query.result } : {}),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      }),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { [sortBy]: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async findOne(id: number) {
    const log = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!log) throw new BusinessException(ErrorCode.NOT_FOUND, '审计日志不存在');
    return log;
  }
}
