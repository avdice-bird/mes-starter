import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { isPrismaUniqueViolation } from '../filters/all-exceptions.filter';

/** 审计脱敏：params 摘要里绝不出现的字段（密码、token 类） */
const SENSITIVE_KEYS = new Set(['password', 'newpassword', 'oldpassword', 'refreshtoken', 'accesstoken', 'token']);

/** 装饰在接口上：跳过审计（如登录接口——虽然密码已脱敏，但仍避免记录高频敏感入口的参数） */
export const SKIP_AUDIT_KEY = 'skipAudit';
export const SkipAudit = (): MethodDecorator =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_target: object, _key: string | symbol, descriptor: any) => {
    Reflect.defineMetadata(SKIP_AUDIT_KEY, true, descriptor.value);
    return descriptor;
  };

/** 脱敏：递归一层足够（本项目 DTO 都是平的），密码/token 替换为 *** */
export function sanitize(obj: unknown, depth = 0): unknown {
  if (obj === null || typeof obj !== 'object' || depth > 1) return typeof obj === 'object' ? '[object]' : obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) out[k] = '***';
    else if (typeof v === 'object' && v !== null) out[k] = sanitize(v, depth + 1);
    else if (typeof v === 'string' && v.length > 200) out[k] = v.slice(0, 200) + '…';
    else out[k] = v;
  }
  return out;
}

/** 从路径取模块与动作：/api/dicts/3/items → dicts | POST:/items 风格动作 */
export function parseModuleAction(path: string, method: string): { module: string; action: string } {
  const segs = path.replace(/^\/api\//, '').split('/').filter(Boolean);
  const module = segs[0] ?? '';
  // 动作：写方法 + 资源段（跳过 id 参数段——纯数字主键，DELETE /users/381 才不会记成 "delete:"）
  const lastMeaningful = [...segs.slice(1)].reverse().find((s) => !/^\d+$/.test(s)) ?? '';
  const actionMap: Record<string, string> = { POST: 'create', PATCH: 'update', PUT: 'update', DELETE: 'delete' };
  const action = method === 'GET' ? 'query' : `${actionMap[method] ?? method.toLowerCase()}${lastMeaningful ? `:${lastMeaningful}` : ''}`;
  return { module, action };
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    const req = context.switchToHttp().getRequest();
    const handler = context.getHandler();

    // 只审计写操作；@SkipAudit() 的接口跳过
    const skip = this.reflector.get<boolean>(SKIP_AUDIT_KEY, handler);
    if (req.method === 'GET' || skip) return next.handle();

    const { module, action } = parseModuleAction(req.path ?? req.originalUrl ?? '', req.method);
    const userId = req.user?.id ?? null;
    const username = req.user?.username ?? '';
    const params = JSON.stringify({
      query: sanitize(req.query ?? {}),
      body: sanitize(req.body ?? {}),
    });
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';

    return next.handle().pipe(
      tap(() => {
        void this.write({ userId, username, method: req.method, path: req.path, module, action, params, result: 'success', durationMs: Date.now() - started, ip });
      }),
      catchError((err) => {
        // 失败也记录：审计层先于异常过滤器拿到原始异常，这里做与过滤器一致的翻译——
        // BusinessException → 业务码（1002/1005…）；Prisma P2002 → 1005（唯一冲突）；
        // 其余 → HTTP 状态。审计的读者关心业务语义，不是 Prisma 错误码
        const result = isPrismaUniqueViolation(err)
          ? '1005'
          : String(err?.code ?? err?.status ?? 'error');
        void this.write({ userId, username, method: req.method, path: req.path, module, action, params, result, durationMs: Date.now() - started, ip });
        return throwError(() => err);
      }),
    );
  }

  /** 审计写入失败不阻塞业务：吞掉异常只打日志 */
  private async write(data: {
    userId: number | null; username: string; method: string; path: string;
    module: string; action: string; params: string; result: string; durationMs: number; ip: string;
  }) {
    try {
      await this.prisma.auditLog.create({ data: { ...data, username: data.username ?? '' } });
    } catch (e) {
      console.error('[audit] 写入失败:', (e as Error).message);
    }
  }
}
