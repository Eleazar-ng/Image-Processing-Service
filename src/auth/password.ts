import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended Argon2id minimum: 19 MiB of memory, 2 iterations, 1 lane.
// The algorithm defaults to Argon2id (covered by a unit test). The parameters
// are encoded in each hash, so they can be raised later without breaking
// existing passwords.
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Returns false (never throws) for a wrong password or a malformed hash. */
export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
