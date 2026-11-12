import { SetMetadata } from '@nestjs/common';
import type { Role } from '../auth.types.js';

export const ROLES_KEY = 'roles';

/** Restricts a route (or controller) to callers holding one of these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
