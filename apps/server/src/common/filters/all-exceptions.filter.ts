import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ErrorCode, ErrorMessage } from '@mes/shared';
import { BusinessException } from '../exceptions/business.exception';

/** 统一异常 → { code, message }；不向前端泄漏堆栈、SQL、内部路径 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: number = ErrorCode.INTERNAL;
    let message: string = ErrorMessage[ErrorCode.INTERNAL];
    let details: unknown;

    // body-parser 的 PayloadTooLargeError 不是 HttpException——按客户端错误归 400，不泄漏为 500
    if ((exception as { message?: string })?.message?.includes('entity too large')) {
      status = 400;
      code = ErrorCode.VALIDATION;
      message = '请求体过大';
    } else if (exception instanceof BusinessException) {
      status = exception.getStatus();
      code = exception.code;
      message = (exception.getResponse() as any).message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      // 请求体超限（PayloadTooLargeError 是 500 系 Error 被包成 HttpException 的场景少见，
      // 这里按 413 → 400 语义归一：客户端问题不该返回 500）
      if (status === 413 || (exception as { message?: string }).message?.includes('entity too large')) {
        status = 400;
      }
      const body = exception.getResponse() as any;
      code =
        status === 401
          ? ErrorCode.UNAUTHORIZED
          : status === 403
            ? ErrorCode.FORBIDDEN
            : status === 404
              ? ErrorCode.NOT_FOUND
              : status === 429
                ? ErrorCode.TOO_MANY
                : status === 400
                  ? ErrorCode.VALIDATION
                  : status;
      // ValidationPipe 的 message 是数组：取第一条给用户，全部放 details
      const msg = typeof body === 'string' ? body : body?.message;
      message =
        code === ErrorCode.TOO_MANY
          ? ErrorMessage[ErrorCode.TOO_MANY]
          : Array.isArray(msg)
            ? msg[0]
            : (msg ?? (ErrorMessage as any)[code] ?? exception.message);
      details = Array.isArray(msg) ? msg : undefined;
    } else if (isPrismaUniqueViolation(exception)) {
      status = 409; code = ErrorCode.CONFLICT; message = ErrorMessage[ErrorCode.CONFLICT];
    } else if (isPrismaNotFound(exception)) {
      // P2025（findUniqueOrThrow / update-or-throw 等未命中）：资源不存在 → 404，不是 500
      status = 404; code = ErrorCode.NOT_FOUND; message = '资源不存在';
    } else {
      this.logger.error(`${req?.method} ${req?.url} ${(exception as Error)?.stack ?? exception}`);
    }
    res.status(status).json({ code, message, data: null, details });
  }
}

/** Prisma P2002：唯一约束冲突 */
export function isPrismaUniqueViolation(e: unknown, field?: string): boolean {
  const err = e as { code?: string; meta?: { target?: string[] | string } };
  if (err?.code !== 'P2002') return false;
  if (!field) return true;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? '').includes(field);
}

/** Prisma P2025：查询/更新目标不存在（系统性收口"资源不存在 → 500"的漏洞类） */
export function isPrismaNotFound(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2025';
}
