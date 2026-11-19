import { factoryDateOf, splitByDay } from './equipment-time';

/**
 * 第 47 节【测】splitByDay 纯函数单测（任务卡用例 1、2）。
 * 期望值手算：北京 22:00–次日 02:00 = 两天各 120 分钟。
 * 北京 22:00 = UTC 14:00（同 UTC 日）；北京次日 02:00 = UTC 前一日 18:00。
 * 工厂日切分点：北京 24:00 = UTC 16:00。
 */
describe('splitByDay 停机跨天切分（第 47 节）', () => {
  it('用例1：北京 22:00–次日 02:00 → 两天日报各 120 分钟', () => {
    // 北京 2026-01-10 22:00 = UTC 2026-01-10T14:00Z
    // 北京 2026-01-11 02:00 = UTC 2026-01-10T18:00Z
    const start = new Date('2026-01-10T14:00:00.000Z');
    const end = new Date('2026-01-10T18:00:00.000Z');
    const splits = splitByDay(start, end);
    expect(splits).toEqual([
      { date: '2026-01-10', minutes: 120 },
      { date: '2026-01-11', minutes: 120 },
    ]);
  });

  it('同一天内的停机 → 单条', () => {
    // 北京 09:00–10:30 = UTC 01:00–02:30
    const splits = splitByDay(new Date('2026-01-10T01:00:00.000Z'), new Date('2026-01-10T02:30:00.000Z'));
    expect(splits).toEqual([{ date: '2026-01-10', minutes: 90 }]);
  });

  it('跨 UTC 日但同工厂日 → 还是单条（北京 07:00–09:00 跨 UTC 23:00–01:00）', () => {
    // 北京 2026-01-11 07:00 = UTC 2026-01-10T23:00Z；北京 09:00 = UTC 2026-01-11T01:00Z
    const splits = splitByDay(new Date('2026-01-10T23:00:00.000Z'), new Date('2026-01-11T01:00:00.000Z'));
    expect(splits).toEqual([{ date: '2026-01-11', minutes: 120 }]);
  });

  it('整 24 小时停机（北京 01-11 00:00–01-12 00:00）→ 单条 1440（恰为一个工厂日）', () => {
    const splits = splitByDay(new Date('2026-01-10T16:00:00.000Z'), new Date('2026-01-11T16:00:00.000Z'));
    expect(splits).toEqual([{ date: '2026-01-11', minutes: 1440 }]);
  });
  it('跨两个工厂日的 30 小时 → 1440 + 360（手算：22h + 8h）', () => {
    // 北京 01-11 00:00 – 01-12 06:00 = UTC 01-10 16:00 – 01-11 22:00
    // 01-11 占 1440，01-12 占 06:00 = 360
    const splits = splitByDay(new Date('2026-01-10T16:00:00.000Z'), new Date('2026-01-11T22:00:00.000Z'));
    expect(splits).toEqual([
      { date: '2026-01-11', minutes: 1440 },
      { date: '2026-01-12', minutes: 360 },
    ]);
  });

  it('结束 ≤ 开始 → 空数组（不产出负时长）', () => {
    expect(splitByDay(new Date('2026-01-10T10:00:00.000Z'), new Date('2026-01-10T10:00:00.000Z'))).toEqual([]);
    expect(splitByDay(new Date('2026-01-10T11:00:00.000Z'), new Date('2026-01-10T10:00:00.000Z'))).toEqual([]);
  });

  it('三天长停机 → 三段累加等于总时长', () => {
    // 北京 01-10 22:00 – 01-13 04:00 = UTC 01-10 14:00 – 01-12 20:00 = 54 小时 = 3240 分钟
    const splits = splitByDay(new Date('2026-01-10T14:00:00.000Z'), new Date('2026-01-12T20:00:00.000Z'));
    const total = splits.reduce((s, x) => s + x.minutes, 0);
    expect(total).toBe(3240);
    expect(splits).toHaveLength(4); // 10/11/12/13 四天有份（首尾不满天）
  });

  it('factoryDateOf：UTC 16:00 = 北京次日 00:00（工厂日切分点）', () => {
    expect(factoryDateOf(new Date('2026-01-10T15:59:00.000Z'))).toBe('2026-01-10'); // 北京 23:59
    expect(factoryDateOf(new Date('2026-01-10T16:00:00.000Z'))).toBe('2026-01-11'); // 北京 00:00
  });
});
