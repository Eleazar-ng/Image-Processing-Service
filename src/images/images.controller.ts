import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { Page } from '../common/pagination/cursor.js';
import { ImageFileService } from './image-file.service.js';
import type { ImageResponse } from './image-response.js';
import {
  type FileQuery,
  type ImageIdParam,
  type ListImagesQuery,
  fileQuerySchema,
  imageIdParamSchema,
  listImagesQuerySchema,
} from './images.schemas.js';
import { ImagesService } from './images.service.js';
import { readUploadedFile } from './read-upload.js';
import { UPLOAD_FIELD_NAME } from './upload.constants.js';

@ApiTags('images')
@ApiBearerAuth()
@Controller('images')
export class ImagesController {
  constructor(
    private readonly images: ImagesService,
    private readonly files: ImageFileService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Upload an image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [UPLOAD_FIELD_NAME],
      properties: {
        [UPLOAD_FIELD_NAME]: {
          type: 'string',
          format: 'binary',
          description:
            'JPEG, PNG, WebP, AVIF, GIF, or TIFF, up to 10 MiB and 50 megapixels.',
        },
      },
    },
  })
  async upload(
    @Req() request: FastifyRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<ImageResponse> {
    const file = await readUploadedFile(request);
    return this.images.upload(user, file);
  }

  @Get()
  @ApiOperation({ summary: 'List your images, newest first' })
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: listImagesQuerySchema }) query: ListImagesQuery,
  ): Promise<Page<ImageResponse>> {
    return this.images.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get the metadata of one of your images' })
  get(
    @CurrentUser() user: AuthUser,
    @Param({ schema: imageIdParamSchema }) params: ImageIdParam,
  ): Promise<ImageResponse> {
    return this.images.get(user, params.id);
  }

  @Get(':id/file')
  @ApiOperation({
    summary: 'Download the original file',
    description:
      'Add `?download=true` to receive it as an attachment instead of inline.',
  })
  async file(
    @CurrentUser() user: AuthUser,
    @Param({ schema: imageIdParamSchema }) params: ImageIdParam,
    @Query({ schema: fileQuerySchema }) query: FileQuery,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const image = await this.images.findOwned(user, params.id);
    await this.files.send(request, reply, image, query.download === 'true');
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete one of your images' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param({ schema: imageIdParamSchema }) params: ImageIdParam,
  ): Promise<void> {
    return this.images.softDelete(user, params.id);
  }
}
