/** M2（第 22 节）：物料导入 200 条；BOM 展开与标准答案一致；循环引用被拒；路线查询正确。
 *  教师按标准种子填入 EXPECTED_SUMMARY（成品编码 → 叶子需求表）。 */
const EXPECTED_SUMMARY = { /* 'IC-100': { 'PCB-001': 1, 'MCU-001': 1, ... } */ };
export default [
  { name: '登录 admin', async run(c) { await c.login('admin', 'Admin@123'); } },
  { name: '物料数量 ≥ 200', async run(c) { const r = await c.call('GET', '/materials?pageSize=1', { token: c.tokens.admin }); c.expect(r.body.data.total >= 200, `实际 ${r.body?.data?.total}`); } },
  { name: 'BOM 展开与标准答案一致', async run(c) {
    for (const [code, expected] of Object.entries(EXPECTED_SUMMARY)) {
      const m = await c.call('GET', `/materials?keyword=${code}&pageSize=1`, { token: c.tokens.admin });
      const r = await c.call('GET', `/materials/${m.body.data.list[0].id}/active-bom?explode=1&qty=1`, { token: c.tokens.admin });
      for (const [leaf, qty] of Object.entries(expected)) c.expect(r.body.data.summary[leaf] === qty, `${code}: ${leaf} 期望 ${qty} 实际 ${r.body.data.summary[leaf]}`);
    }
    if (!Object.keys(EXPECTED_SUMMARY).length) throw new Error('教师尚未填入 EXPECTED_SUMMARY');
  } },
  { name: '循环引用被拒（2003）', async run(c) {
    const t = c.tokens.admin;
    const find = async (code) => {
      const r = await c.call('GET', `/materials?keyword=${code}&pageSize=1`, { token: t });
      return r.body.data.list[0]?.id;
    };
    const a = await find('IC-M00001');
    const b = await find('IC-M00002');
    // 幂等：先清上次运行残留的 cycle BOM（DRAFT 可直接删）
    for (const [mid, ver] of [[a, 'v-cycle-a'], [b, 'v-cycle-b']]) {
      const mine = await c.call('GET', `/boms?keyword=&pageSize=200&status=DRAFT`, { token: t });
      for (const row of mine.body.data.list ?? []) {
        if (row.materialId === mid && row.version === ver) await c.call('DELETE', `/boms/${row.id}`, { token: t });
      }
    }
    const b1 = await c.call('POST', '/boms', { body: { materialId: a, version: 'v-cycle-a', effectiveFrom: '2026-01-01' }, token: t });
    const b2 = await c.call('POST', '/boms', { body: { materialId: b, version: 'v-cycle-b', effectiveFrom: '2026-01-01' }, token: t });
    c.expect(b1.status === 201 && b2.status === 201, `建 BOM 失败 ${b1.status}/${b2.status}`);
    await c.call('PUT', `/boms/${b1.body.data.id}/items`, { body: { items: [{ childMaterialId: b, qty: 1, scrapRate: 0 }] }, token: t });
    const res = await c.call('PUT', `/boms/${b2.body.data.id}/items`, { body: { items: [{ childMaterialId: a, qty: 1, scrapRate: 0 }] }, token: t });
    c.expect(res.status === 422 && res.body.code === 2003, `期望 422/2003，实际 ${res.status}/${res.body.code}`);
  } },
  { name: 'active-routing 返回按 seq 排序的工序', async run(c) {
    const t = c.tokens.admin;
    const m = await c.call('GET', '/materials?keyword=IC-M00001&pageSize=1', { token: t });
    const r = await c.call('GET', `/materials/${m.body.data.list[0].id}/active-routing`, { token: t });
    c.expect(r.status === 200, `status ${r.status} ${r.body?.message ?? ''}`);
    const seqs = r.body.data.operations.map((o) => o.seq);
    c.expect(seqs.length > 0, '无工序');
    const sorted = [...seqs].sort((x, y) => x - y);
    c.expect(JSON.stringify(seqs) === JSON.stringify(sorted), `工序未按 seq 排序: ${seqs}`);
  } },
];
