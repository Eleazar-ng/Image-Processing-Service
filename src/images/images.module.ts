import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AdminImagesController } from './admin-images.controller.js';
import { AdminImagesService } from './admin-images.service.js';
import { ImageFileService } from './image-file.service.js';
import { ImagesController } from './images.controller.js';
import { ImagesService } from './images.service.js';

@Module({
  imports: [PrismaModule, StorageModule, AuditModule],
  controllers: [ImagesController, AdminImagesController],
  providers: [ImagesService, AdminImagesService, ImageFileService],
})
export class ImagesModule {}
