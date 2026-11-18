import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DatabaseHealthIndicator } from './database.health.js';
import { HealthController } from './health.controller.js';
import { StorageModule } from '../storage/storage.module.js';
import { StorageHealthIndicator } from './storage.health.js';

@Module({
  imports: [TerminusModule, PrismaModule, StorageModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, StorageHealthIndicator],
})
export class HealthModule {}
