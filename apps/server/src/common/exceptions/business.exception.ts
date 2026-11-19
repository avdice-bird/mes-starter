import { HttpException } from '@nestjs/common';
import { ErrorCode, ErrorHttpStatus, ErrorMessage } from '@mes/shared';

export { ErrorCode };

/** 业务异常：throw new BusinessException(ErrorCode.STOCK_SHORT, '物料 M-001 不足') */
export class BusinessException extends HttpException {
  constructor(public readonly code: ErrorCode, message?: string, public readonly details?: unknown) {
    super({ code, message: message ?? ErrorMessage[code], details }, ErrorHttpStatus[code] ?? 400);
  }
}
