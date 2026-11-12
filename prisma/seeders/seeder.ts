import type { PrismaClient } from '../../src/generated/prisma/client.js';

export interface Seeder {
  name: string;
  run: (prisma: PrismaClient) => Promise<void>;
}
