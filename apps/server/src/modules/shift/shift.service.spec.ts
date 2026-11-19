import { ShiftService, factoryLocal, parseHHmm, FACTORY_TZ } from './shift.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 第 25 节【测】当前班次算法单测（任务卡要求全覆盖）。
 * 核心原则：时间固定传入（getCurrentShift(at) 不内部取 new Date()）；
 * 时区测试固定 ISO 字符串（北京 = UTC+8）。
 */
describe('ShiftService.getCurrentShift（固定时间单测）', () => {
  const svc = new ShiftService({ shift: { findMany: jest.fn() } } as unknown as PrismaService);

  /** 种子班次：早 08-16 / 中 16-23:59 / 晚 00-08（跨天） */
  const shifts = [
    { id: 1, code: 'SH-EARLY', name: '早班', startTime: '08:00', endTime: '16:00', crossDay: false },
    { id: 2, code: 'SH-MID', name: '中班', startTime: '16:00', endTime: '23:59', crossDay: false },
    { id: 3, code: 'SH-NIGHT', name: '晚班', startTime: '00:00', endTime: '08:00', crossDay: false },
  ];

  function mockShifts(list: typeof shifts) {
    (svc as any).prisma.shift.findMany.mockResolvedValue(list);
  }

  it('08:00 整点属于早班（边界含头不含尾：[start, end)）', async () => {
    mockShifts(shifts);
    const at = new Date('2026-06-01T08:00:00+08:00');
    expect((await svc.getCurrentShift(at))?.name).toBe('早班');
    // 15:59 仍是早班
    expect((await svc.getCurrentShift(new Date('2026-06-01T15:59:00+08:00')))?.name).toBe('早班');
  });

  it('16:00 整点属于中班（早班的 end 不含尾）', async () => {
    mockShifts(shifts);
    const at = new Date('2026-06-01T16:00:00+08:00');
    expect((await svc.getCurrentShift(at))?.name).toBe('中班');
  });

  it('晚班 00:30 命中（00:00–08:00 区间）', async () => {
    mockShifts(shifts);
    expect((await svc.getCurrentShift(new Date('2026-06-01T00:30:00+08:00')))?.name).toBe('晚班');
  });

  it('跨天班次 22:00–06:00：23:00 与 05:00 都命中（22:00–06:00 也在场时中班让位于重叠检查前建）', async () => {
    // 22:00-06:00 跨天：crossDay=true（end 360 <= start 1320）
    const night: typeof shifts = [
      { id: 4, code: 'SH-N2', name: '夜班', startTime: '22:00', endTime: '06:00', crossDay: true },
    ];
    mockShifts(night);
    expect((await svc.getCurrentShift(new Date('2026-06-01T23:00:00+08:00')))?.name).toBe('夜班');
    expect((await svc.getCurrentShift(new Date('2026-06-02T05:00:00+08:00')))?.name).toBe('夜班');
  });

  it('空档返回 null（12:00–24:00 无班次）', async () => {
    mockShifts([{ id: 1, code: 'A', name: '早班', startTime: '08:00', endTime: '12:00', crossDay: false }]);
    expect(await svc.getCurrentShift(new Date('2026-06-01T15:00:00+08:00'))).toBeNull();
  });

  it('服务器时区 UTC 时，北京 10:00（UTC 02:00）判为早班', async () => {
    // factoryLocal 用固定偏移（Asia/Shanghai = +8），不依赖 process.env.TZ——
    // 即使容器 TZ=UTC，new Date('2026-06-01T02:00:00Z') 的 UTC 毫秒 + 8h = 北京 10:00
    const { minutesOfDay } = factoryLocal(new Date('2026-06-01T02:00:00Z'));
    expect(minutesOfDay).toBe(600); // 10:00
    mockShifts(shifts);
    expect((await svc.getCurrentShift(new Date('2026-06-01T02:00:00Z')))?.name).toBe('早班');
  });

  it('parseHHmm 边界：24:00 拒绝，00:00 = 0，23:59 = 1439', () => {
    expect(parseHHmm('00:00')).toBe(0);
    expect(parseHHmm('23:59')).toBe(1439);
    expect(() => parseHHmm('24:00')).toThrow();
    expect(() => parseHHmm('8:00x')).toThrow();
  });

  it('FACTORY_TZ 默认 Asia/Shanghai（配置驱动，第 24 节用例 12）', () => {
    expect(FACTORY_TZ).toBe('Asia/Shanghai');
  });
});
