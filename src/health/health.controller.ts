import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../auth/decorators/public.decorator.js';
import { DatabaseHealthIndicator } from './database.health.js';
import { StorageHealthIndicator } from './storage.health.js';

@Public()
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly storage: StorageHealthIndicator,
  ) {}

  /** Liveness: the process is up and serving requests. No dependencies. */
  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return this.health.check([]);
  }

  /**
   * Readiness: dependencies are reachable. PostgreSQL and object storage
   * today; Redis is added when it arrives.
   */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe' })
  ready() {
    return this.health.check([
      () => this.database.isHealthy('database'),
      () => this.storage.isHealthy('storage'),
    ]);
  }
}
