import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import type { Env } from '../config/env.schema.js';
import { ROLES, type Role } from './auth.types.js';

const accessClaimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(ROLES),
});

export interface AccessTokenClaims {
  sub: string;
  role: Role;
}

@Injectable()
export class TokenService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', {
      infer: true,
    });
    this.refreshTtlSeconds = config.get('REFRESH_TOKEN_TTL_SECONDS', {
      infer: true,
    });
  }

  get accessTokenTtlSeconds(): number {
    return this.accessTtlSeconds;
  }

  signAccessToken(user: { id: string; role: Role }): Promise<string> {
    return this.jwt.signAsync(
      { role: user.role },
      { subject: user.id, expiresIn: this.accessTtlSeconds },
    );
  }

  /**
   * Verifies signature, algorithm, and expiry, then re-validates the claim
   * shape. Throws on any failure.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const payload = await this.jwt.verifyAsync(token);
    return accessClaimsSchema.parse(payload);
  }

  /** An opaque 256-bit random token. Only its hash is ever stored. */
  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  refreshTokenExpiry(now: Date = new Date()): Date {
    return new Date(now.getTime() + this.refreshTtlSeconds * 1000);
  }
}
