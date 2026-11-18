import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { ImagesController } from './images.controller.js';
import { ImagesService } from './images.service.js';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [ImagesController],
  providers: [ImagesService],
})
export class ImagesModule {}
