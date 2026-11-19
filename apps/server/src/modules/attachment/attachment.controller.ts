import {
  Controller, Get, Param, ParseIntPipe, Post, Query, Req, Res, UploadedFile,
  UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { AttachmentService } from './attachment.service';

type ReqUser = Request & { user: { id: number; username: string } };

@ApiTags('attachments')
@ApiBearerAuth()
@Controller('attachments')
export class AttachmentController {
  constructor(private attachments: AttachmentService) {}

  @Post()
  @Permissions('attachment:upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传附件（pdf/png/jpg，≤10MB）' })
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('refType') refType: string,
    @Query('refId') refId: string,
    @Req() req: ReqUser,
  ) {
    const id = Number(refId);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('refId 非法');
    return this.attachments.upload(file, refType, id, req.user.username);
  }

  @Get()
  @Permissions('attachment:download')
  @ApiOperation({ summary: '按引用查附件列表' })
  list(@Query('refType') refType: string, @Query('refId') refId: string) {
    const id = Number(refId);
    if (!refType || !Number.isInteger(id) || id <= 0) throw new BadRequestException('refType/refId 非法');
    return this.attachments.listByRef(refType, id);
  }

  @Get(':id/download')
  @Permissions('attachment:download')
  @ApiOperation({ summary: '下载附件（原文件名）' })
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { buffer, fileName, mimeType } = await this.attachments.download(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(fileName));
    res.send(buffer);
  }
}
