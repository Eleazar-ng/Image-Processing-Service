export const ROLES = ['USER', 'ADMIN'] as const;

export type Role = (typeof ROLES)[number];

/** The authenticated caller, attached to the request by the JWT guard. */
export interface AuthUser {
  id: string;
  role: Role;
}

export interface AuthenticatedRequest {
  user?: AuthUser;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Access token lifetime in seconds. */
  expiresIn: number;
}
