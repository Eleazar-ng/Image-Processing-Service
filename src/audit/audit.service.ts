import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { AuthUser } from '../auth/auth.types.js';

export type AuditAction =
  | 'admin.image.list'
  | 'admin.image.view'
  | 'admin.image.download'
  | 'admin.image.delete';

export interface AuditEvent {
  action: AuditAction;
  actor: AuthUser;
  imageId?: string;
  ownerId?: string;
  details?: Record<string, unknown>;
}

/**
 * Records privileged actions as structured log events (D-083). Each line
 * carries an `audit` object, so the events can be filtered and shipped
 * separately from ordinary logs.
 */
@Injectable()
export class AuditService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AuditService.name);
  }

  record(event: AuditEvent): void {
    this.logger.info(
      {
        audit: {
          action: event.action,
          actorId: event.actor.id,
          actorRole: event.actor.role,
          imageId: event.imageId,
          ownerId: event.ownerId,
          ...event.details,
        },
      },
      'Audit event',
    );
  }
}
