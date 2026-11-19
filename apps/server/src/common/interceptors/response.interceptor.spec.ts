import { of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  const ctx = { switchToHttp: () => ({ getResponse: () => ({ headersSent: false }) }) } as any;

  it('应把 data 包装成 { code: 0, message: ok, data }', (done) => {
    new ResponseInterceptor().intercept(ctx, { handle: () => of({ a: 1 }) }).subscribe((r) => {
      expect(r).toEqual({ code: 0, message: 'ok', data: { a: 1 } });
      done();
    });
  });

  it('data 为 undefined 时应返回 null', (done) => {
    new ResponseInterceptor().intercept(ctx, { handle: () => of(undefined) }).subscribe((r) => {
      expect(r.data).toBeNull();
      done();
    });
  });
});
