import { z } from 'zod';
import { hashPassword } from '../../src/auth/password.js';
import type { Seeder } from './seeder.js';

// Read from the environment, never committed. Mirrors the registration policy.
const adminEnvSchema = z.object({
  ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  ADMIN_PASSWORD: z.string().min(12).max(128),
});

/**
 * Creates the first admin. Safe to re-run: an existing admin is left alone
 * (its password is never reset), and an existing non-admin account with the
 * same email is an error rather than a silent promotion.
 */
export const adminSeeder: Seeder = {
  name: 'admin user',
  async run(prisma) {
    const parsed = adminEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid admin seed configuration:\n${z.prettifyError(parsed.error)}`,
      );
    }
    const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role === 'ADMIN') {
        process.stdout.write(`Admin ${email} already exists; nothing to do.\n`);
        return;
      }
      throw new Error(
        `A user with email ${email} already exists without the ADMIN role. ` +
          'Promote it deliberately or choose another ADMIN_EMAIL.',
      );
    }

    await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        role: 'ADMIN',
      },
    });
    process.stdout.write(`Created admin ${email}.\n`);
  },
};
