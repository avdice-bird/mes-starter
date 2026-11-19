import { Module } from '@nestjs/common';
import { LabelsController } from './labels.controller';
import { LabelsService } from './labels.service';
import { AttachmentController } from '../attachment/attachment.controller';
import { AttachmentService } from '../attachment/attachment.service';

/** 标签与附件（第 55 节）：打印标签 + SOP 附件上传/下载。一张 Attachment 表。 */
@Module({
  controllers: [LabelsController, AttachmentController],
  providers: [LabelsService, AttachmentService],
})
export class LabelsModule {}
