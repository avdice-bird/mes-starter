/**
 * 幂等种子：可反复执行，存在则跳过（upsert）。
 * RBAC 数据（权限码、角色、用户、菜单）在 seed-rbac.ts；以后业务主数据继续往下加。
 */
import { PrismaClient } from '@prisma/client';
import { seedRbac } from './seed-rbac';
import { seedMasterData, seedDicts, seedInventory, seedDefectCodes, seedDowntimeReasons, seedAndonDicts } from './seed-master';
import { seedDemoBusiness } from './seed-demo';

const prisma = new PrismaClient();

async function main() {
  await prisma.systemSetting.upsert({
    where: { key: 'schema_version' }, update: { value: '0.1' },
    create: { key: 'schema_version', value: '0.1', remark: '骨架版本；upsert 示例——所有种子都这样写才幂等' },
  });
  await seedRbac(prisma);
  await seedMasterData(prisma);
  await seedDicts(prisma);
  await seedInventory(prisma);
  await seedDefectCodes(prisma);
  await seedDowntimeReasons(prisma);
  await seedAndonDicts(prisma);
  await seedDemoBusiness(prisma);
  console.log('seed: ok');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
