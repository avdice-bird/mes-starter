import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, pct, rolesText, fmtQty } from '@/utils/format';

describe('H5 格式化工具', () => {
  it('空值统一显示占位符', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });

  it('formatDate 取到日期部分', () => {
    expect(formatDate('2026-11-06T13:30:00.000Z')).toBe('2026-11-06');
  });

  it('formatDateTime 默认不带年份，withYear 带年份', () => {
    expect(formatDateTime('2026-11-06T13:30:00.000Z')).toBe('11-06 13:30');
    expect(formatDateTime('2026-11-06T13:30:00Z', true)).toBe('2026-11-06 13:30');
  });

  it('pct 边界：分母为 0 与封顶 100', () => {
    expect(pct(3, 0)).toBe(0);
    expect(pct(7, 10)).toBe(70);
    expect(pct(20, 10)).toBe(100);
  });

  it('rolesText 映射角色编码并在空时给默认值', () => {
    expect(rolesText(['admin', 'operator'])).toBe('管理员 · 操作工');
    expect(rolesText([])).toBe('生产现场');
    expect(rolesText(['unknown'])).toBe('unknown');
  });

  it('fmtQty 空值按 0 处理', () => {
    expect(fmtQty(null)).toBe('0');
    expect(fmtQty(1234567)).toBe('1,234,567');
  });
});
