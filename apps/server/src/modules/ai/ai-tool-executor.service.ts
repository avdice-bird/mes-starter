import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { InventoryService } from '../inventory/inventory.service';
import { AndonService } from '../andon/andon.service';
import { ShiftService } from '../shift/shift.service';
import { type ToolResult } from './ai.tools';

/** 工具执行器：只读；每个工具内部走现有 Service（权限防线在原 Service/Controller 层，第 56 节要点）。 */
@Injectable()
export class AiToolExecutor {
  private readonly logger = new Logger(AiToolExecutor.name);

  constructor(
    private prisma: PrismaService,
    private reports: ReportsService,
    private inventory: InventoryService,
    private andon: AndonService,
    private shifts: ShiftService,
  ) {}

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (name) {
      case 'getYield': {
        const rows = await this.reports.yield({
          from: this.dateArg(args.from), to: this.dateArg(args.to),
          groupBy: typeof args.groupBy === 'string' ? args.groupBy : 'date',
        });
        return { summary: `良率 ${rows.length} 组`, data: rows };
      }
      case 'getWorkOrderProgress': {
        const rows = await this.reports.workOrderProgress({
          from: this.dateArg(args.from), to: this.dateArg(args.to),
          status: typeof args.status === 'string' ? args.status : undefined,
        });
        return { summary: `工单 ${rows.length} 张`, data: rows };
      }
      case 'getOee': {
        const rows = await this.reports.oee({
          from: this.dateArg(args.from), to: this.dateArg(args.to),
          equipmentId: Number.isInteger(args.equipmentId) ? (args.equipmentId as number) : undefined,
        });
        return { summary: `OEE ${rows.length} 台设备`, data: rows };
      }
      case 'getInventory': {
        const code = typeof args.materialCode === 'string' ? args.materialCode.trim() : '';
        if (!code || code.length > 64) throw new BadRequestException('materialCode 非法');
        // 物料编码精确匹配（Prisma 参数化，注入无效——第 57 节红队用例 4）
        const mat = await this.prisma.material.findFirst({
          where: { code, isDeleted: false },
          select: { id: true, code: true, name: true },
        });
        if (!mat) return { summary: `物料 ${code} 不存在`, data: [] };
        const r = await this.inventory.listBalances({ materialId: mat.id, pageSize: 50 });
        return { summary: `物料 ${code}（${mat.name}）余额 ${r.total} 行`, data: r.list };
      }
      case 'getAndonCalls': {
        const status = typeof args.status === 'string' ? args.status : 'OPEN';
        const r = await this.andon.list({ status, pageSize: 50 });
        return { summary: `安灯（${status}）${r.total} 条`, data: r.list };
      }
      case 'getCurrentShift': {
        const shift = await this.shifts.getCurrentShift(new Date());
        return { summary: '当前班次', data: shift };
      }
      default:
        throw new BadRequestException(`未知工具 ${name}`);
    }
  }

  /** 日期参数防御：只接受 yyyy-MM-dd，其余忽略（LLM 产出的参数不可信） */
  private dateArg(v: unknown): string | undefined {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  }
}
