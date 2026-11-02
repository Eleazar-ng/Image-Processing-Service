import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  /**
   * Liveness only: the process is up and serving requests. Readiness checks
   * (database, Redis, storage) are added as each dependency is introduced.
   */
  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return this.health.check([]);
  }
}
