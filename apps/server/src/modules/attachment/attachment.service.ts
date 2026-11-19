import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { PrismaService } from '../../prisma/prisma.service';

/** 附件（第 55 节）：SOP 作业指导书。类型/大小白名单 + 服务端 uuid 落盘（防路径穿越与同名冲突）。 */
@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);

  /** 上传根目录：env 可覆盖（CI 只读环境不传附件） */
  private readonly root = process.env.UPLOAD_DIR ?? 'uploads';

  private static readonly ALLOWED = new Map<string, string>([
    ['application/pdf', '.pdf'],
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
  ]);
  private static readonly MAX_SIZE = 10 * 1024 * 1024; // 10MB

  constructor(private prisma: PrismaService) {}

  async upload(file: Express.Multer.File | undefined, refType: string, refId: number, operator: string) {
    if (!file || !file.buffer?.length) throw new BadRequestException('未收到文件');
    if (!refType || !Number.isInteger(refId) || refId <= 0) throw new BadRequestException('refType/refId 缺失或非法');
    // mime + 扩展名双校验（改扩展名上传被 mime 拦，mime 伪造被扩展名拦一半——足够课堂口径）
    const ext = AttachmentService.ALLOWED.get(file.mimetype);
    if (!ext) throw new BadRequestException(`不支持的类型 ${file.mimetype}（仅 pdf/png/jpg）`);
    if (!ext.includes(extname(file.originalname).toLowerCase()) && !(ext === '.jpg' && extname(file.originalname).toLowerCase() === '.jpeg')) {
      throw new BadRequestException('扩展名与文件类型不符');
    }
    if (file.size > AttachmentService.MAX_SIZE) throw new BadRequestException('文件超过 10MB');

    // 服务端生成路径：客户端文件名只存库（下载时作展示名），杜绝 ../ 穿越
    const fileName = `${randomUUID()}${ext}`;
    await mkdir(this.root, { recursive: true });
    await writeFile(`${this.root}/${fileName}`, file.buffer);

    // busboy 以 latin1 解析 multipart 文件名：非 ASCII 名（中文）需还原 UTF-8
    const rawName = file.originalname;
    const fixedName = /[-ÿ]/.test(rawName) ? Buffer.from(rawName, 'latin1').toString('utf8') : rawName;
    const row = await this.prisma.attachment.create({
      data: {
        fileName: fixedName.slice(0, 200),
        path: `${this.root}/${fileName}`,
        mimeType: file.mimetype,
        size: file.size,
        refType, refId,
        uploadedBy: operator,
      },
    });
    this.logger.log(`attachment ${row.id} ${refType}#${refId} ${file.originalname} (${file.size}B) by ${operator}`);
    return { id: row.id, fileName: row.fileName, mimeType: row.mimeType, size: row.size };
  }

  async listByRef(refType: string, refId: number) {
    return this.prisma.attachment.findMany({
      where: { refType, refId },
      orderBy: { id: 'desc' },
      select: { id: true, fileName: true, mimeType: true, size: true, uploadedBy: true, createdAt: true },
    });
  }

  /** 下载：读文件流回原文件名；path 来自库（服务端生成），不存在 404 */
  async download(id: number) {
    const row = await this.prisma.attachment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`附件 ${id} 不存在`);
    try {
      const buffer = await readFile(row.path);
      return { buffer, fileName: row.fileName, mimeType: row.mimeType };
    } catch {
      throw new NotFoundException(`附件 ${id} 的文件已丢失`);
    }
  }
}
