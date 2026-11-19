import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import { AppModule } from '../../src/app.module';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedRbac } from '../../prisma/seed-rbac';

/** 起一个与 main.ts 配置一致的测试应用；测试库先跑 migrate */
export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: { ...process.env } });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** 清空全部业务表（按依赖顺序：先关联表后主表）。随模型增加维护这个列表。 */
export async function resetDb(prisma: PrismaService) {
  const tables = ['Notification', 'AndonCall', 'EquipmentDailyReport', 'Downtime', 'EquipmentStatusLog', 'InspectionDefect', 'Inspection', 'DefectCode', 'InventoryTransaction', 'InventoryBalance', 'MaterialIssueItem', 'MaterialIssue', 'Lot', 'Warehouse', 'WorkReport', 'WorkOrderOperation', 'WorkOrderStatusLog', 'EmployeeSkill', 'EmployeeTransfer', 'Employee', 'Team', 'Shift', 'RoutingOperation', 'Routing', 'Equipment', 'WorkCenter', 'WorkOrder', 'ProductionOrder', 'BomItem', 'Bom', 'AuditLog', 'DictItem', 'Dict', 'RolePermission', 'UserRole', 'RefreshToken', 'Menu', 'Permission', 'Role', 'User', 'Material', 'MaterialCategory', 'Unit'];
  for (const t of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${t}";`);
}

/** 重置后灌入 RBAC 种子（权限码、角色、5 个用户、菜单），与开发库 seed 同一份数据 */
export async function seedRbacForTest(prisma: PrismaService) {
  await seedRbac(prisma as never);
}

/** 用种子账号登录，返回双 token */
export async function login(
  app: INestApplication,
  username: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const supertest = (await import('supertest')).default;
  let res;
  for (let attempt = 0; ; attempt += 1) {
    res = await supertest(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password });
    if (res.status === 200) break;
    // 登录限流（20/min）：套件级测试会连续登录，429 时等满当前分钟窗口重试（最多 3 次）
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 60_000 - (Date.now() % 60_000) + 2_000));
      continue;
    }
    throw new Error(`登录失败(${res.status}): ${username}`);
  }
  return { accessToken: res.body.data.accessToken, refreshToken: res.body.data.refreshToken };
}
