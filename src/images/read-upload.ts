import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { MAX_UPLOAD_BYTES, UPLOAD_FIELD_NAME } from './upload.constants.js';
import type { UploadedFile } from './images.service.js';

function missingFile(detail: string): BadRequestException {
  return new BadRequestException(detail, { errorCode: 'MISSING_FILE' });
}

function isFileTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'FST_REQ_FILE_TOO_LARGE'
  );
}

/**
 * Reads the single uploaded file into memory. The size limit is enforced
 * while the stream is read, so an oversized upload is cut off early.
 */
export async function readUploadedFile(
  request: FastifyRequest,
): Promise<UploadedFile> {
  if (!request.isMultipart()) {
    throw missingFile('Send the image as multipart/form-data.');
  }

  const part = await request.file();
  if (part?.fieldname !== UPLOAD_FIELD_NAME) {
    throw missingFile(
      `Attach the image in a form field named "${UPLOAD_FIELD_NAME}".`,
    );
  }

  try {
    return { buffer: await part.toBuffer(), filename: part.filename };
  } catch (error) {
    if (isFileTooLarge(error)) {
      throw new PayloadTooLargeException(
        `The file exceeds the ${String(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`,
        { errorCode: 'FILE_TOO_LARGE' },
      );
    }
    throw error;
  }
}
