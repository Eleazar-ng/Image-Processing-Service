import type { User } from '../generated/prisma/client.js';

/** The fields of a user that are safe to return from the API. */
export interface PublicUser {
  id: string;
  email: string;
  role: User['role'];
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}
