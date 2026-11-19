import * as fs from 'node:fs';
import * as path from 'node:path';
import { MENUS, ROLES, PERMISSIONS } from '../prisma/rbac-data';

/**
 * 菜单×页面×角色一致性回归（防"菜单能点进去、页面数据却 403"）：
 * 安灯页、设备状态页两次事故的同款模式——菜单绑的码放人进来了，页面挂载期拉的接口却要别的码。
 * 纯静态检查（不依赖框架反射）：角色码来自 rbac-data，菜单组件映射同源，
 * 页面所需码 = 组件里 import 的 api 函数 → 端点 → Controller @Permissions 反查。
 *
 * 约定：
 * - 组件只允许从 '@/api/*' 导入接口函数（与 api 层的分层一致）；
 * - "按权限守卫的拉取"必须写成单行 `has('码') ? 调用 : 兜底`（见 AndonList onMounted），
 *   扫描器据此识别为条件拉取、不设硬性要求；其他位置的 GET 调用一律视为挂载期需要。
 */

/** 服务端端点 → 所需权限码。无 @Permissions 的接口登录即可，记为无要求。 */
function buildEndpointCodes(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const RE_CONTROLLER = /@Controller\(\s*(?:'([^']*)')?\s*\)/;
  const RE_METHOD = /@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/;
  const RE_CODE = /['"]([a-z]+:[a-z-]+)['"]/g;

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.name.endsWith('.controller.ts')) out.push(full);
    }
    return out;
  };

  const key = (method: string, prefix: string, p: string) =>
    `${method} /api/${prefix}/${p}`.replace(/\/+/g, '/').replace(/\/$/, '');

  for (const file of walk(path.resolve(__dirname, '../src/modules'))) {
    let prefix = '';
    let pending: { method: string; path: string; codes: string[] } | null = null;
    const flush = () => {
      if (pending) map.set(key(pending.method, prefix, pending.path), pending.codes);
      pending = null;
    };
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const ctrl = line.match(RE_CONTROLLER);
      if (ctrl) {
        flush();
        prefix = ctrl[1] ?? '';
        continue;
      }
      const m = line.match(RE_METHOD);
      if (m) {
        flush();
        pending = { method: m[1].toUpperCase(), path: m[2] ?? '', codes: [] };
        continue;
      }
      if (!pending) continue;
      // @Public 接口不写 @Permissions，codes 自然为空 → 无要求，无需特殊处理
      const pm = line.match(/@Permissions\(([^)]*)\)/);
      if (pm) for (const c of pm[1].matchAll(RE_CODE)) pending.codes.push(c[1]);
    }
    flush();
  }
  return map;
}

interface ApiIndex {
  /** 直接包装 http 调用的函数 → { method, path } */
  http: Map<string, { method: string; path: string }>;
  /** api→api 依赖（动态 import 其它 api 模块的包装函数，如 listLotsForLabels → listLots） */
  deps: Map<string, Set<string>>;
  /** api 层全部导出名（自检导入名拼写用） */
  exports: Set<string>;
}

function buildApiIndex(): ApiIndex {
  const idx: ApiIndex = { http: new Map(), deps: new Map(), exports: new Set() };
  const apiDir = path.resolve(__dirname, '../../web/src/api');
  const reExport = /export (?:const|async function|function) (\w+)/g;
  const reHttp = /\b(get|post|put|patch|del)\b(?:<[\s\S]*?>)?\(\s*['"`]([^'"`]+)['"`]/;
  const reCall = /\b([a-z][A-Za-z0-9]*)\s*\(/g;
  const slices = new Map<string, string>();
  for (const file of fs.readdirSync(apiDir).filter((f) => f.endsWith('.ts') && f !== 'http.ts')) {
    const text = fs.readFileSync(path.join(apiDir, file), 'utf8');
    const marks: { name: string; start: number }[] = [];
    for (const m of text.matchAll(reExport)) marks.push({ name: m[1], start: m.index ?? 0 });
    for (let i = 0; i < marks.length; i += 1) {
      const slice = text.slice(marks[i].start, i + 1 < marks.length ? marks[i + 1].start : undefined);
      slices.set(marks[i].name, slice);
      idx.exports.add(marks[i].name);
      const call = slice.match(reHttp);
      if (call) {
        const pathWithQuery = `/api${call[2]}`.replace(/\$\{[^}]+\}/g, '*');
        idx.http.set(marks[i].name, { method: call[1].toUpperCase(), path: pathWithQuery.split('?')[0].replace(/\/$/, '') });
      }
    }
  }
  // 依赖解析：块内调用的标识符 ∩ api 层导出名（排除自身）——'map(' 这类方法名会被导出名过滤掉
  for (const [name, slice] of slices) {
    const called = new Set<string>();
    for (const m of slice.matchAll(reCall)) called.add(m[1]);
    const deps = new Set([...called].filter((n) => n !== name && idx.exports.has(n)));
    if (deps.size > 0) idx.deps.set(name, deps);
  }
  return idx;
}

const endpointCodes = buildEndpointCodes();
const api = buildApiIndex();
const webViewsDir = path.resolve(__dirname, '../../web/src/views');

/** 组件挂载期（未守卫的 GET 调用）所需权限码 */
function componentRequirements(component: string): Set<string> {
  const file = path.join(webViewsDir, `${component}.vue`);
  const text = fs.readFileSync(file, 'utf8');
  const used = new Set<string>();
  for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'@\/api\//g)) {
    for (const raw of m[1].split(',')) {
      const t = raw.trim();
      if (!t || t.startsWith('type ')) continue; // 类型导入不是接口调用
      used.add(t.split(' as ')[0].trim());
    }
  }
  const required = new Set<string>();
  // 间接包装展开一层：组件 → listLotsForLabels → listLots（GET 端点的码要求穿透包装）
  for (const fn of [...used]) for (const dep of api.deps.get(fn) ?? []) used.add(dep);
  for (const fn of used) {
    const ep = api.http.get(fn);
    if (!ep || ep.method !== 'GET') continue; // 写操作按按钮显隐兜底，非 HTTP 工具函数无要求
    const codes = endpointCodes.get(ep.path) ?? [];
    if (codes.length === 0) continue; // 登录即可（如 dict options）
    // 单行 has('码') ? 调用 : 兜底 → 按权限守卫，角色没码就不拉，不设硬要求（间接调用在 api 层内部，无法守卫，一律要求）
    const guarded = new RegExp(`\\.has\\('[^']+'\\)\\s*\\?\\s*[^\\n]*?\\b${fn}\\(`).test(text);
    if (!guarded) for (const c of codes) required.add(c);
  }
  return required;
}

describe('菜单×页面×角色一致性（防"能点进去但页面 403"）', () => {
  it('组件导入的 api 名都是 api 层真实导出（自证扫描没漏，抓拼写错误）', () => {
    expect(api.exports.size).toBeGreaterThan(50);
    const unmapped: string[] = [];
    for (const menu of MENUS) {
      if (!menu.component) continue;
      const file = path.join(webViewsDir, `${menu.component}.vue`);
      if (!fs.existsSync(file)) continue; // 组件路径错误由 registerDynamicRoutes 的运行时警告兜底
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'@\/api\//g)) {
        for (const raw of m[1].split(',')) {
          const t = raw.trim();
          if (!t || t.startsWith('type ')) continue; // 类型导入不是接口调用
          const name = t.split(' as ')[0].trim();
          if (name && !api.exports.has(name)) unmapped.push(`${menu.component}: ${name}`);
        }
      }
    }
    expect(unmapped).toEqual([]);
  });

  it('每个可见菜单组件的挂载期 GET 接口所需权限码，可见角色全部持有', () => {
    const allCodes = PERMISSIONS.map(([c]) => c);
    const violations: string[] = [];
    for (const role of ROLES) {
      const owned = new Set(role.codes === 'ALL' ? allCodes : role.codes);
      for (const menu of MENUS) {
        if (!menu.component || !menu.permissionCode) continue;
        if (!owned.has(menu.permissionCode)) continue; // 看不到的菜单不检查
        for (const code of componentRequirements(menu.component)) {
          if (!owned.has(code)) violations.push(`${role.code} 可见 ${menu.path}（组件 ${menu.component}）但缺少页面所需码 ${code}`);
        }
      }
    }
    expect(violations).toEqual([]); // 若失败：给角色补码，或把页面拉取改成单行 has('码') ? 调用 : 兜底
  });

  it('菜单绑的权限码必须是该组件实际需要的 view 码（防止绑错码：进了页面但主数据 403）', () => {
    const violations: string[] = [];
    for (const menu of MENUS) {
      if (!menu.component || !menu.permissionCode) continue;
      const required = componentRequirements(menu.component);
      if (required.size > 0 && !required.has(menu.permissionCode)) {
        violations.push(`${menu.path} 绑了 ${menu.permissionCode}，但页面实际需要：${[...required].join('、')}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
