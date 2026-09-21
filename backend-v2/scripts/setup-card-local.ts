import { spawnSync } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const databaseUrl = new URL(process.env.DATABASE_URL || '');
  const allowedHosts = new Set(['db', 'localhost', '127.0.0.1']);
  if (databaseUrl.protocol !== 'mysql:' || databaseUrl.pathname !== '/zhuiyi_blog'
    || !allowedHosts.has(databaseUrl.hostname)) {
    throw new Error('本地初始化只允许连接 zhuiyi_blog 隔离数据库');
  }
  if (process.env.FEISHU_DATA_ENV !== 'Test') throw new Error('本地初始化要求 FEISHU_DATA_ENV=Test');

  const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (migration.status !== 0) throw new Error('本地 MySQL migration 执行失败');

  const username = process.env.LOCAL_CARD_ADMIN_USERNAME || 'card-local';
  const password = process.env.LOCAL_CARD_ADMIN_PASSWORD || '123456';
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(username) || password.length < 6) {
    throw new Error('本地管理员用户名或密码配置无效');
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.admin.upsert({
      where: { username },
      create: { username, password: passwordHash, isActive: true },
      update: { password: passwordHash, isActive: true },
    });
    await prisma.admin.upsert({
      where: { username: 'admin' },
      create: { username: 'admin', password: passwordHash, isActive: true },
      update: { password: passwordHash, isActive: true },
    });
    const compliance = {
      static_compliance_enabled: 'true',
      static_compliance_icp_number: '本地测试 ICP 备案号',
      static_compliance_police_number: '本地测试公安备案号',
      static_compliance_police_record_code: '11000000000001',
    };
    for (const [key, value] of Object.entries(compliance)) {
      await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value, isSecret: false } });
    }
    await prisma.systemConfig.deleteMany({
      where: { key: { in: ['static_icp_number', 'static_police_number', 'static_police_record_code'] } },
    });
    console.log(`[LocalSetup] 本地发卡管理员已就绪: ${username}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
