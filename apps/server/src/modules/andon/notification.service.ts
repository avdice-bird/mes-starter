import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException, ErrorCode } from '../../common/exceptions/business.exception';
import type { ListNotificationDto } from './dto/andon.dto';

/** 站内信（第 50 节）：列表/未读数/标记已读；标记别人的 → 403（第 51 节用例 8） */
@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaService) {}

  async list(userId: number, query: ListNotificationDto) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Math.min(Number(query.pageSize) > 0 ? Number(query.pageSize) : 20, 200);
    const where = {
      userId,
      ...(query.read === 'read' ? { isRead: true } : {}),
      ...(query.read === 'unread' ? { isRead: false } : {}),
    };
    const [list, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async unreadCount(userId: number) {
    const count = await this.prisma.notification.count({ where: { userId, isRead: false } });
    return { count };
  }

  async markRead(id: number, userId: number) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n) throw new BusinessException(ErrorCode.NOT_FOUND, `通知 ${id} 不存在`);
    if (n.userId !== userId) throw new BusinessException(ErrorCode.FORBIDDEN, '仅可标记自己的通知');
    await this.prisma.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
    const { count } = await this.unreadCount(userId);
    return { id, unreadCount: count };
  }
}
