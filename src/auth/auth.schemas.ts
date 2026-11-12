import { z } from 'zod';

/** Trimmed and lowercased before validation (D-047). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

/** Length only, no composition rules (D-060). */
export const passwordSchema = z.string().min(12).max(128);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // The registration policy is not re-applied here, so login never hints at it.
  password: z.string().min(1).max(128),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).max(256),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
