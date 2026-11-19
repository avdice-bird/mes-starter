import {
  ImportRow, validateImportRows, normalizeType, isKnownTypeLabel, RefData,
} from './import-validate';

/**
 * 第 15 节【测】导入校验纯函数单测：直接喂行数组，不起应用、不 mock Prisma。
 * 覆盖第 14 节 12 种错法中属于"行校验"的部分（文件级错误如非 xlsx 在 e2e 覆盖）。
 */

const ref: RefData = {
  unitCodes: new Set(['PCS', 'KG']),
  categoryCodes: new Set(['CAP', 'RES']),
  existingMaterialCodes: new Set(['M-EXISTS']),
};

/** 行工厂：合法基线，各用例覆盖个别字段 */
const row = (code: string, overrides: Partial<Omit<ImportRow, 'rowNumber' | 'code'>> = {}, rowNumber = 2): ImportRow => ({
  rowNumber, code, name: `物料${code}`, spec: '', categoryCode: 'CAP', unitCode: 'PCS', type: 'RAW', safetyStock: '100', ...overrides,
});

describe('validateImportRows（导入校验纯函数）', () => {
  it('全部合法行：0 错误', () => {
    const errors = validateImportRows([row('M-1'), row('M-2', {}, 3), row('M-3', { type: 'FINISHED' }, 4)], ref);
    expect(errors).toEqual([]);
  });

  it('文件内两行编码相同：两行都报错并互相指认行号', () => {
    const errors = validateImportRows([row('M-DUP', {}, 2), row('M-DUP', {}, 3)], ref);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.rowNumber).sort()).toEqual([2, 3]);
    expect(errors[0].message).toContain('第 3 行');
    expect(errors[1].message).toContain('第 2 行');
  });

  it('三行同码：每行指出另外两行', () => {
    const errors = validateImportRows([row('M-T', {}, 2), row('M-T', {}, 3), row('M-T', {}, 4)], ref);
    expect(errors).toHaveLength(3);
    // sort 返回后每行报错指认的正是"另外两行"
    const byRow = new Map(errors.map((e) => [e.rowNumber, e.message]));
    expect(byRow.get(2)).toMatch(/第 3、4 行重复/);
    expect(byRow.get(3)).toMatch(/第 2、4 行重复/);
    expect(byRow.get(4)).toMatch(/第 2、3 行重复/);
  });

  it('与库中已有编码重复：报"已存在"，不更新', () => {
    const errors = validateImportRows([row('M-EXISTS')], ref);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('已存在');
  });

  it('编码为空：报"不能为空"', () => {
    const errors = validateImportRows([row('')], ref);
    expect(errors[0].message).toContain('物料编码不能为空');
  });

  it('名称缺失：报"名称不能为空"', () => {
    const errors = validateImportRows([row('M-N', { name: '' })], ref);
    expect(errors[0].message).toContain('名称不能为空');
  });

  it('单位编码不存在：报错并含单位编码', () => {
    const errors = validateImportRows([row('M-U', { unitCode: 'XXX' })], ref);
    expect(errors[0].message).toContain('XXX');
    expect(errors[0].message).toContain('单位编码');
  });

  it('分类编码不存在：报错并含分类编码', () => {
    const errors = validateImportRows([row('M-C', { categoryCode: 'NOPE' })], ref);
    expect(errors[0].message).toContain('NOPE');
    expect(errors[0].message).toContain('分类');
  });

  it('非法类型：报错并提示全部可选值', () => {
    const errors = validateImportRows([row('M-TY', { type: '原材料' })], ref);
    expect(errors[0].message).toContain('原材料');
    expect(errors[0].message).toContain('原料/半成品/成品');
  });

  it('类型为空：报错并提示可选值', () => {
    const errors = validateImportRows([row('M-T2', { type: '' })], ref);
    expect(errors[0].message).toContain('类型不能为空');
  });

  it('全角编码：报全角提示（不静默转换）', () => {
    const errors = validateImportRows([row('Ｍ-FULL')], ref);
    expect(errors[0].message).toContain('全角');
  });

  it('安全库存非数字：报错；空字符串（未填）不报错', () => {
    const bad = validateImportRows([row('M-S1', { safetyStock: 'abc' })], ref);
    expect(bad[0].message).toContain('安全库存');
    const empty = validateImportRows([row('M-S2', { safetyStock: '' })], ref);
    expect(empty).toEqual([]);
  });

  it('一行多个错误：拼接为一条（分号分隔）', () => {
    const errors = validateImportRows([row('M-M', { name: '', unitCode: 'NOPE' })], ref);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('；');
  });

  it('错误按行号排序输出', () => {
    const errors = validateImportRows([row('M-B', { name: '' }, 5), row('Ａ-BAD', {}, 3)], ref);
    expect(errors.map((e) => e.rowNumber)).toEqual([3, 5]);
  });
});

describe('normalizeType / isKnownTypeLabel', () => {
  it('枚举值原样返回，中文标签转枚举', () => {
    expect(normalizeType('RAW')).toBe('RAW');
    expect(normalizeType(' 原料 ')).toBe('RAW');
    expect(normalizeType('半成品')).toBe('SEMI');
    expect(normalizeType('成品')).toBe('FINISHED');
  });

  it('两种写法都被认作合法类型', () => {
    expect(isKnownTypeLabel('RAW')).toBe(true);
    expect(isKnownTypeLabel('原料')).toBe(true);
    expect(isKnownTypeLabel('原材料')).toBe(false);
  });
});
