import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { AndonService } from './andon.service';

/**
 * 安灯超时升级定时任务（第 51 节用例 13）：每分钟扫描超时未响应的 OPEN 呼叫。
 * 逻辑全部在 AndonService.escalateTimeouts(now)——任务体只传当前时间，
 * 测试直接调方法传固定时间，不 sleep（第 52 节检查题）。
 * 升级幂等：escalated=true 被查询排除，重启重复调度不会重复通知。
 * @nestjs/schedule ESM 不兼容 Jest——同设备日报任务用 require('cron') 注册（test 环境跳过）。
 */
@Injectable()
export class AndonEscalationTask implements OnApplicationBootstrap {
  constructor(private andon: AndonService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CronJob } = require('cron');
      const job = new CronJob('0 * * * * *', () => void this.scan());
      job.start();
    } catch (e) {
      console.error('[andon-escalation] cron init failed:', (e as Error).message);
    }
  }

  async scan() {
    try {
      const n = await this.andon.escalateTimeouts(new Date());
      if (n > 0) console.log(`[andon-escalation] escalated ${n} calls`);
    } catch (e) {
      console.error(`[andon-escalation] ${(e as Error).message}`);
    }
  }
}
