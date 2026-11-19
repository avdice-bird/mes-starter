import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ log: process.env.PRISMA_LOG === 'query' ? ['query'] : [] });
  }
  async onModuleInit() {
    await this.$connect();
    // SQLite：并发写排队等待而不是立刻报 "database is locked"（第 33 节）
    await this.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
    await this.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
