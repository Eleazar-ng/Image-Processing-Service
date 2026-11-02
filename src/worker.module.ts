import { Module } from '@nestjs/common';
import { AppLoggingModule } from './common/logging/logging.module.js';
import { AppConfigModule } from './config/app-config.module.js';

/**
 * Root module of the worker process. Queue processors (BullMQ) are
 * registered here in Stage 7.
 */
@Module({
  imports: [AppConfigModule, AppLoggingModule],
})
export class WorkerModule {}
