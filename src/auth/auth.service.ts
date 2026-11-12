import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isUniqueViolation } from '../common/database/prisma-errors.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type PublicUser, toPublicUser } from '../users/public-user.js';
import { UsersService } from '../users/users.service.js';
import type { AuthTokens } from './auth.types.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

export interface AuthSession {
  user: PublicUser;
  tokens: AuthTokens;
}

type RefreshTokenStore = Pick<PrismaService, 'refreshToken'>;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async register(input: RegisterInput): Promise<AuthSession> {
    const passwordHash = await this.passwords.hash(input.password);

    let user: User;
    try {
      user = await this.users.create({ email: input.email, passwordHash });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email is already registered', {
          errorCode: 'EMAIL_TAKEN',
        });
      }
      throw error;
    }

    return this.startSession(user);
  }

  async login(input: LoginInput): Promise<AuthSession> {
    const user = await this.users.findByEmail(input.email);

    if (!user) {
      // Spend comparable time as a real check, then fail identically.
      await this.passwords.verifyAgainstDummy(input.password);
      throw this.invalidCredentials();
    }

    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      throw this.invalidCredentials();
    }

    return this.startSession(user);
  }

  /**
   * Rotates the refresh token: the presented token is revoked and a new one
   * in the same family is issued. Presenting an already-revoked token means
   * it was stolen or replayed, so the whole family is revoked.
   */
  async refresh(refreshToken: string): Promise<{ tokens: AuthTokens }> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) {
      throw this.invalidRefreshToken();
    }

    if (record.revokedAt) {
      await this.revokeFamily(record.familyId);
      throw this.invalidRefreshToken();
    }

    if (record.expiresAt <= new Date()) {
      throw this.invalidRefreshToken();
    }

    const tokens = await this.prisma.$transaction(async (tx) => {
      // Conditional update: only one concurrent request can win the rotation.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) {
        return null;
      }
      return this.issueTokens(tx, record.user, record.familyId);
    });

    if (!tokens) {
      // Lost a race with another use of the same token: treat as replay.
      await this.revokeFamily(record.familyId);
      throw this.invalidRefreshToken();
    }

    return { tokens };
  }

  /** Revokes the whole session. Idempotent: unknown tokens are ignored. */
  async logout(refreshToken: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
    });

    if (record) {
      await this.revokeFamily(record.familyId);
    }
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists', {
        errorCode: 'INVALID_ACCESS_TOKEN',
      });
    }
    return toPublicUser(user);
  }

  private async startSession(user: User): Promise<AuthSession> {
    // Every login starts a new family; rotations keep the family.
    const tokens = await this.issueTokens(this.prisma, user, randomUUID());
    return { user: toPublicUser(user), tokens };
  }

  private async issueTokens(
    store: RefreshTokenStore,
    user: User,
    familyId: string,
  ): Promise<AuthTokens> {
    const refreshToken = this.tokens.generateRefreshToken();

    await store.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokens.hashRefreshToken(refreshToken),
        familyId,
        expiresAt: this.tokens.refreshTokenExpiry(),
      },
    });

    return {
      accessToken: await this.tokens.signAccessToken(user),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTokenTtlSeconds,
    };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid email or password', {
      errorCode: 'INVALID_CREDENTIALS',
    });
  }

  private invalidRefreshToken(): UnauthorizedException {
    return new UnauthorizedException('Invalid refresh token', {
      errorCode: 'INVALID_REFRESH_TOKEN',
    });
  }
}
