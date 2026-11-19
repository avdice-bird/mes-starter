// 集成测试用独立的 SQLite 文件，与 dev.db 隔离
process.env.DATABASE_URL = process.env.DATABASE_URL?.includes('test') ? process.env.DATABASE_URL : 'file:./test.db?connection_limit=1';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
process.env.NODE_ENV = 'test';
// 仅 e2e 进程内允许 /auth/captcha 返回 target，供 supertest 自动完成滑块；生产/开发永不暴露
process.env.CAPTCHA_EXPOSE_TARGET = 'true';
