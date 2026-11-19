import * as fs from 'node:fs';
import * as path from 'node:path';
import { PERMISSIONS } from '../prisma/rbac-data';

/**
 * 第 7 节用例 8 + 第 8 节任务 4：
 * 扫描所有业务 Controller 里 @Permissions('...') 的权限码，断言都存在于种子权限表。
 * 防止装饰器里写了字典里不存在的码——那种码谁都不会有，接口会 403 到永远。
 * （用正则扫源码而不是反射：不依赖框架内部 API，Controller 不需要在测试里实例化。）
 */
describe('权限码扫描（@Permissions 必须都在种子里）', () => {
  const modulesDir = path.resolve(__dirname, '../src/modules');

  function collectControllerFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...collectControllerFiles(full));
      else if (entry.name.endsWith('.controller.ts')) out.push(full);
    }
    return out;
  }

  it('所有 Controller 的 @Permissions 权限码都已在种子表登记', () => {
    const files = collectControllerFiles(modulesDir);
    expect(files.length).toBeGreaterThan(0);

    const seeded = new Set(PERMISSIONS.map(([code]) => code));
    const used: { file: string; code: string }[] = [];
    const re = /@Permissions\(([^)]*)\)/g;
    const codeRe = /['"]([a-z]+:[a-z-]+)['"]/g;

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const m of content.matchAll(re)) {
        for (const c of m[1].matchAll(codeRe)) {
          used.push({ file: path.relative(modulesDir, file), code: c[1] });
        }
      }
    }
    expect(used.length).toBeGreaterThan(0);

    const unknown = used.filter((u) => !seeded.has(u.code));
    expect(unknown).toEqual([]); // 若失败：把列出的码补进 prisma/rbac-data.ts 再改代码
  });

  it('种子权限表本身没有重复的码', () => {
    const codes = PERMISSIONS.map(([code]) => code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  /**
   * 第 9 节攻击项 7 的防线（CLAUDE.md RBAC 约定）：
   * 每个 Controller 方法必须 @Permissions(...) 或 @Public() 二选一。
   * 唯一例外是"只操作 token 本人"的认证接口，在下方白名单按"文件名 方法名"逐个登记——
   * 以后新增无码接口必须来这里登记，否则测试红，防止"忘了声明 → 默认放行"被悄悄带上线。
   */
  it('每个 Controller 方法都有 @Permissions 或 @Public（或登记在认证白名单）', () => {
    const files = collectControllerFiles(modulesDir);
    // HTTP 方法装饰器起头（可能带路由参数，如 @Get(':id')），吞完整装饰器堆叠块，
    // 捕获其后的方法名——一个正则拿全块+方法名，避免"块内剥装饰器"与
    // "窗口越界吃进下一方法的 @Public"两类错
    const RE_HANDLER =
      /@(Get|Post|Put|Patch|Delete)\((?:[^()]|\([^()]*\))*\)\s*(?:@\w+\((?:[^()]|\([^()]*\))*\)\s*)*((?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\()/g;
    // 白名单：只操作 token 本人、不涉及权限码的认证接口，按"文件名 方法名"逐个登记（不是整文件放行）
    const AUTH_WHITELIST = new Set([
      'auth.controller.ts login',
      'auth.controller.ts refresh',
      'auth.controller.ts logout',
      'auth.controller.ts me',
      // 字典下拉：登录即可用（各业务页面的下拉都靠它），操作面只读
      'dict.controller.ts optionsByCode',
    ]);

    const missing: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const rel = path.relative(modulesDir, file);
      for (const m of content.matchAll(RE_HANDLER)) {
        // m[0] = @Get 起到方法名( 为止的整段装饰器堆叠，绝不越过方法名，也就不会把
        // 下一个方法的 @Public 算进本方法（第 9 节防线的变异验证发现了这个盲区）
        const block = m[0];
        const hasPerm = /@Permissions\(/.test(block);
        const hasPublic = /@Public\(\)/.test(block);
        if (hasPerm || hasPublic) continue;
        const key = `${path.basename(file)} ${m[3]}`;
        if (!AUTH_WHITELIST.has(key)) missing.push(`${rel}: @${m[1]} → ${key}`);
      }
    }
    expect(missing).toEqual([]); // 若失败：给方法加 @Permissions / @Public，或确认属认证类接口后按"文件 方法"登记白名单
  });
});
