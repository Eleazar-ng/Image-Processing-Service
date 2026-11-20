import type { PinoLogger } from 'nestjs-pino';
import { vi } from 'vitest';
import { AuditService } from './audit.service.js';

function setup() {
  const logger = { setContext: vi.fn(), info: vi.fn() };
  const service = new AuditService(logger as unknown as PinoLogger);
  return { service, logger };
}

const actor = { id: 'admin_1', role: 'ADMIN' } as const;

describe('AuditService', () => {
  it('sets its own logging context', () => {
    const { logger } = setup();

    expect(logger.setContext).toHaveBeenCalledWith('AuditService');
  });

  it('logs the action, the actor, and the target under an audit key', () => {
    const { service, logger } = setup();

    service.record({
      action: 'admin.image.delete',
      actor,
      imageId: 'img_1',
      ownerId: 'user_9',
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        audit: {
          action: 'admin.image.delete',
          actorId: 'admin_1',
          actorRole: 'ADMIN',
          imageId: 'img_1',
          ownerId: 'user_9',
        },
      },
      'Audit event',
    );
  });

  it('includes extra details', () => {
    const { service, logger } = setup();

    service.record({
      action: 'admin.image.list',
      actor,
      details: { includeDeleted: true, limit: 50 },
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        audit: expect.objectContaining({
          action: 'admin.image.list',
          includeDeleted: true,
          limit: 50,
        }) as unknown,
      },
      'Audit event',
    );
  });
});
