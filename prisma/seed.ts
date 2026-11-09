import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

interface Seeder {
  name: string;
  run: (prisma: PrismaClient) => Promise<void>;
}

// Stage 3 registers the admin seeder here, once password hashing exists.
const seeders: Seeder[] = [];

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
