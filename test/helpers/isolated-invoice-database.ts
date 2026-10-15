import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
export async function isolatedInvoiceDatabase() {
  const name = 'goods_invoice_test_' + randomUUID().replace(/-/g, '');
  const container = JSON.parse(
    execFileSync('docker', ['inspect', 'whazzonline-postgres'], {
      encoding: 'utf8',
    }),
  )[0] as { Config: { Env: string[] } };
  const env = Object.fromEntries(
    container.Config.Env.map((v) => {
      const i = v.indexOf('=');
      return [v.slice(0, i), v.slice(i + 1)];
    }),
  );
  const url = new URL(
    `postgresql://localhost:5433/${env.POSTGRES_DB || env.POSTGRES_USER}`,
  );
  url.username = env.POSTGRES_USER;
  url.password = env.POSTGRES_PASSWORD;
  const original = process.env.DATABASE_URL,
    admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = '/' + name;
  process.env.DATABASE_URL = url.toString();
  let prisma: PrismaService | undefined;
  const cleanup = async () => {
    if (prisma) await prisma.$disconnect();
    if (
      !/^goods_invoice_test_[a-f0-9]{32}$/.test(name) ||
      new URL(url).pathname !== '/' + name
    )
      throw new Error('Unexpected test database cleanup target');
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  };
  try {
    execFileSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'db', 'push'],
      { env: process.env, stdio: 'pipe', timeout: 180000 },
    );
    prisma = new PrismaService();
    await prisma.$connect();
    return { prisma, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
