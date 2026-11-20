import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  type Page,
  afterCursor,
  decodeCursor,
  toPage,
} from '../common/pagination/cursor.js';
import type { Image } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { imageNotFound } from './image-errors.js';
import {
  type AdminImageResponse,
  toAdminImageResponse,
} from './image-response.js';
import type { AdminListImagesQuery } from './images.schemas.js';

/** Admin access to every user's images. Each action is audited (D-083). */
@Injectable()
export class AdminImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthUser,
    query: AdminListImagesQuery,
  ): Promise<Page<AdminImageResponse>> {
    const { limit, cursor, ownerId, includeDeleted } = query;
    const withDeleted = includeDeleted === 'true';
    const after = cursor ? afterCursor(decodeCursor(cursor)) : {};

    const rows = await this.prisma.image.findMany({
      where: {
        ...(ownerId ? { ownerId } : {}),
        ...(withDeleted ? {} : { deletedAt: null }),
        ...after,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    this.audit.record({
      action: 'admin.image.list',
      actor,
      details: {
        ownerFilter: ownerId ?? null,
        includeDeleted: withDeleted,
        limit,
      },
    });
    return toPage(rows, limit, toAdminImageResponse);
  }

  /** Admins can see an image even after it was soft-deleted. */
  async get(actor: AuthUser, id: string): Promise<AdminImageResponse> {
    const image = await this.find(id);
    this.audit.record({
      action: 'admin.image.view',
      actor,
      imageId: image.id,
      ownerId: image.ownerId,
    });
    return toAdminImageResponse(image);
  }

  async findForDownload(
    actor: AuthUser,
    id: string,
    asAttachment: boolean,
  ): Promise<Image> {
    const image = await this.find(id);
    this.audit.record({
      action: 'admin.image.download',
      actor,
      imageId: image.id,
      ownerId: image.ownerId,
      details: { asAttachment },
    });
    return image;
  }

  /** Soft delete, like an owner's delete: a second attempt is "not found". */
  async softDelete(actor: AuthUser, id: string): Promise<void> {
    const image = await this.prisma.image.findFirst({
      where: { id, deletedAt: null },
    });
    if (!image) {
      throw imageNotFound();
    }

    const { count } = await this.prisma.image.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) {
      throw imageNotFound();
    }

    this.audit.record({
      action: 'admin.image.delete',
      actor,
      imageId: image.id,
      ownerId: image.ownerId,
    });
  }

  private async find(id: string): Promise<Image> {
    const image = await this.prisma.image.findUnique({ where: { id } });
    if (!image) {
      throw imageNotFound();
    }
    return image;
  }
}
