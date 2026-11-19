import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { EquipmentStatusService } from './equipment-status.service';

/**
 * 设备日报定时任务（第 46 节）：每天 00:05 生成前一天的日报。
 * 幂等由 generateDailyReport 的 upsert 保证——重复触发/服务重启重跑都不会翻倍。
 * "生成某天日报"抽成了可手动调用的方法（EquipmentStatusController 的 generate 接口），定时只是调它。
 *
 * @nestjs/schedule 是 ESM 包，Jest CJS 转换不兼容——Cron 装饰器改为 onApplicationBootstrap
 * 里 require 注册（test 环境跳过），任务体不触碰 schedule 包。
 */
@Injectable()
export class EquipmentReportTask implements OnApplicationBootstrap {
  constructor(private status: EquipmentStatusService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { CronJob } = require('cron');
      const job = new CronJob('0 5 0 * * *', () => void this.handleDailyReport());
      job.start();
    } catch (e) {
      console.error('[equipment-report] cron init failed:', (e as Error).message);
    }
  }

  async handleDailyReport() {
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
    try {
      const r = await this.status.generateDailyReport(yesterday);
      console.log(`[equipment-report] ${yesterday}: generated ${r.generated} reports`);
    } catch (e) {
      console.error(`[equipment-report] ${yesterday}: ${(e as Error).message}`);
    }
  }
}
