import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { Page } from '../common/pagination/cursor.js';
import { AdminImagesService } from './admin-images.service.js';
import { ImageFileService } from './image-file.service.js';
import type { AdminImageResponse } from './image-response.js';
import {
  type AdminListImagesQuery,
  type FileQuery,
  type ImageIdParam,
  adminListImagesQuerySchema,
  fileQuerySchema,
  imageIdParamSchema,
} from './images.schemas.js';

/** Admin-only access to every user's images (D-031). */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/images')
export class AdminImagesController {
  constructor(
    private readonly admin: AdminImagesService,
    private readonly files: ImageFileService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all images, newest first' })
  list(
    @CurrentUser() actor: AuthUser,
    @Query({ schema: adminListImagesQuerySchema }) query: AdminListImagesQuery,
  ): Promise<Page<AdminImageResponse>> {
    return this.admin.list(actor, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get any image, including deleted ones' })
  get(
    @CurrentUser() actor: AuthUser,
    @Param({ schema: imageIdParamSchema }) params: ImageIdParam,
  ): Promise<AdminImageResponse> {
    return this.admin.get(actor, params.id);
  }

  @Get(':id/file')
  @ApiOperation({
    summary: 'Download any original file',
    description: 'Add `?download=true` to receive it as an attachment.',
  })
  async file(
    @CurrentUser() actor: AuthUser,
    @Param({ schema: imageIdParamSchema }) params: ImageIdParam,
    @Query({ schema: fileQuerySchema }) query: FileQuery,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const asAttachment = query.download === 'true';
    const image = await this.admin.findForDownload(
      actor,
      params.id,
      asAttachment,
    );
    await this.files.send(request, reply, image, asAttachment);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete any image' })
  remove(
    @CurrentUser() actor: AuthUser,
    @Param({ schema: imageIdParamSchema }) params: ImageIdParam,
  ): Promise<void> {
    return this.admin.softDelete(actor, params.id);
  }
}
