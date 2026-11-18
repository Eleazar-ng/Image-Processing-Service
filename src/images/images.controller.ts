import { Controller, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { ImageResponse } from './image-response.js';
import { ImagesService } from './images.service.js';
import { readUploadedFile } from './read-upload.js';
import { UPLOAD_FIELD_NAME } from './upload.constants.js';

@ApiTags('images')
@ApiBearerAuth()
@Controller('images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

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
            'JPEG, PNG, WebP, AVIF, GIF, or TIFF, up to 10 MB and 50 megapixels.',
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
}
