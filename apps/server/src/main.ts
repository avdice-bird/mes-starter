import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { BoardGateway } from './modules/board/board.gateway';
import { JwtService } from '@nestjs/jwt';
import { Server as HttpServer } from 'http';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // Bearer 头认证、不依赖 cookie：不开 credentials（反射任意来源 + credentials 的组合有 CSRF 面）。
  // origin 白名单来自 WEB_ORIGIN；未配置时开发期放开、生产期一律拒绝。
  app.enableCors({
    origin:
      process.env.WEB_ORIGIN?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? (process.env.NODE_ENV === 'production' ? false : true),
  });
  // 参数校验：白名单 + 自动转换；校验失败 → 1001
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // 看板 WebSocket（第 48 节）：/board 命名空间，握手鉴权 + board:view 权限
  const httpServer = app.getHttpServer() as HttpServer;
  const boardGateway = app.get(BoardGateway);
  const jwt = app.get(JwtService);
  // socket.io 为 ESM，Jest CJS 环境不兼容顶层 import，保留运行时 require
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const io = require('socket.io')(httpServer, { path: '/board/socket.io', cors: { origin: true } });
  boardGateway.attach(
    io.of('/board'),
    (token: string) => jwt.verify(token) as { sub: number },
    async (userId: number) => {
      const owned = await app.get((await import('./prisma/prisma.service')).PrismaService).$queryRaw<{ code: string }[]>`
        SELECT p.code FROM "Permission" p
        JOIN "RolePermission" rp ON rp."permissionId" = p.id
        JOIN "UserRole" ur ON ur."roleId" = rp."roleId"
        WHERE ur."userId" = ${userId} AND p.code = 'board:view'`;
      return owned.length > 0;
    },
  );

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('MES API')
      .setDescription('企业级Web项目开发（AI驱动MES版）')
      .setVersion('0.1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`server: http://localhost:${port}/api  docs: http://localhost:${port}/api/docs`);
}
bootstrap();
