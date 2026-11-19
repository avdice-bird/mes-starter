import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { DictModule } from './modules/dict/dict.module';
import { UserModule } from './modules/user/user.module';
import { RoleModule } from './modules/role/role.module';
import { PermissionModule } from './modules/permission/permission.module';
import { MenuModule } from './modules/menu/menu.module';
import { AuditModule } from './modules/audit/audit.module';
import { BomModule } from './modules/bom/bom.module';
import { WorkCenterModule } from './modules/work-center/work-center.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { RoutingModule } from './modules/routing/routing.module';
import { ShiftModule } from './modules/shift/shift.module';
import { TeamModule } from './modules/team/team.module';
import { EmployeeModule } from './modules/employee/employee.module';
import { UnitModule } from './modules/unit/unit.module';
import { MaterialCategoryModule } from './modules/material-category/material-category.module';
import { MaterialModule } from './modules/material/material.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { WorkReportModule } from './modules/work-report/work-report.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { InspectionModule } from './modules/inspection/inspection.module';
import { BoardModule } from './modules/board/board.module';
import { AndonModule } from './modules/andon/andon.module';
import { ReportsModule } from './modules/reports/reports.module';
import { LabelsModule } from './modules/labels/labels.module';
import { AiModule } from './modules/ai/ai.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // 限流默认值：每分钟 20 次；只对显式挂 ThrottlerGuard 的接口生效（目前是登录）
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    DictModule,
    UserModule,
    RoleModule,
    PermissionModule,
    MenuModule,
    AuditModule,
    BomModule,
    WorkCenterModule,
    EquipmentModule,
    RoutingModule,
    ShiftModule,
    TeamModule,
    EmployeeModule,
    UnitModule,
    MaterialCategoryModule,
    MaterialModule,
    ScheduleModule,
    DispatchModule,
    WorkReportModule,
    InventoryModule,
    InspectionModule,
    BoardModule,
    AndonModule,
    ReportsModule,
    LabelsModule,
    AiModule,
  ],
  // 审计拦截器全局注册：自动记录所有非 GET 请求（@SkipAudit() 跳过）
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
})
export class AppModule {}
