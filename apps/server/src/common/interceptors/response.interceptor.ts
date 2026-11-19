import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ApiResponse, ErrorCode } from '@mes/shared';

/** 统一响应：Controller 直接返回 data，这里包装成 { code: 0, message: 'ok', data } */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const res = context.switchToHttp().getResponse();
    // 文件下载等自行写响应的场景不包装
    return next.handle().pipe(map((data) => (res.headersSent ? (data as any) : { code: ErrorCode.OK, message: 'ok', data: data ?? null })));
  }
}
