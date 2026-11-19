import * as ExcelJS from 'exceljs';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

/** 导入模板的标准表头（与 material 模块 IMPORT_HEADERS 一致） */
export const IMPORT_HEADERS = ['物料编码', '物料名称', '规格型号', '分类编码', '单位编码', '类型', '安全库存'];

export type ImportRowTuple = [string, string, string, string, string, string, string];

/**
 * 测试用 Excel 构造器：全部导入用例复用，不提交 xlsx 文件到仓库（第 15 节约定）。
 * 默认首行是标准表头；表头顺序/缺失/乱序用例通过 overrides 自定义。
 * 返回可直接 supertest .attach('file', buffer, 'materials.xlsx') 的 Buffer。
 */
export async function buildXlsx(rows: ImportRowTuple[], overrides?: {
  header?: string[]; // 自定义表头（打乱顺序 / 缺列 / 多列）
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('物料');
  ws.addRow(overrides?.header ?? [...IMPORT_HEADERS]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 构造非 xlsx 文件（改名 txt 之类）：纯文本字节 */
export function buildFakeXlsx(content = '这不是Excel'): Buffer {
  return Buffer.from(content, 'utf8');
}

/**
 * supertest GET 二进制（xlsx）下载：默认 superagent 会把二进制 body 当文本解析坏，
 * 必须显式 buffer + parse 收集原始字节。
 */
export async function getXlsx(app: INestApplication, url: string, token: string): Promise<Buffer> {
  const res = await request(app.getHttpServer())
    .get(url)
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse((resp, cb) => {
      const chunks: Buffer[] = [];
      resp.on('data', (c: Buffer) => chunks.push(c));
      resp.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  if (res.status !== 200) throw new Error(`下载失败(${res.status}): ${url}`);
  return res.body as Buffer;
}

/** 解析服务端返回的 xlsx buffer 为二维数组（导出断言用） */
export async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  // exceljs 把全局 Buffer 重声明为 extends ArrayBuffer 的接口，与 Node 的 Buffer<ArrayBufferLike>
  // 泛型不兼容（只差在 Symbol.toStringTag）；运行时同构，走 unknown 断言
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  const out: string[][] = [];
  ws.eachRow((row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      values.push(v == null ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: string }).text) : String(v));
    });
    out.push(values);
  });
  return out;
}
