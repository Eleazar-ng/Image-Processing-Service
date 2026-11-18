import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class StorageHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly storage: StorageService,
  ) {}

  isHealthy(key: string) {
    return this.healthIndicatorService
      .check(key)
      .attempt(async () => {
        const q = await this.storage.checkBucket();
        console.log(q);
        return {};
      })
      .withTimeout(2000);
  }
}
