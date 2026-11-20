import { z } from 'zod';
import { paginationQuerySchema } from '../common/pagination/pagination.schemas.js';

export const imageIdParamSchema = z.object({
  id: z.string().min(1).max(64),
});

/** `?download=true` sends the file as an attachment instead of inline. */
export const fileQuerySchema = z.object({
  download: z.enum(['true', 'false']).default('false'),
});

export const listImagesQuerySchema = paginationQuerySchema;

export const adminListImagesQuerySchema = paginationQuerySchema.extend({
  ownerId: z.string().min(1).max(64).optional(),
  includeDeleted: z.enum(['true', 'false']).default('false'),
});

export type ImageIdParam = z.infer<typeof imageIdParamSchema>;
export type FileQuery = z.infer<typeof fileQuerySchema>;
export type ListImagesQuery = z.infer<typeof listImagesQuerySchema>;
export type AdminListImagesQuery = z.infer<typeof adminListImagesQuerySchema>;
