import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { adminSeeder } from './seeders/admin.seeder.js';
import type { Seeder } from './seeders/seeder.js';

const seeders: Seeder[] = [adminSeeder];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    for (const seeder of seeders) {
      process.stdout.write(`Seeding: ${seeder.name}\n`);
      await seeder.run(prisma);
    }
    process.stdout.write(`Seed complete (${seeders.length} seeders).\n`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
