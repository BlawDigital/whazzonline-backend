import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const extensions: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const directory = join(
  resolve(process.env.UPLOAD_DIR ?? 'uploads'),
  'disputes',
);

export const disputeUploadOptions = {
  storage: diskStorage({
    destination: (_request, _file, callback) => {
      mkdirSync(directory, { recursive: true });
      callback(null, directory);
    },
    filename: (_request, file, callback) =>
      callback(null, `${randomUUID()}${extensions[file.mimetype] ?? ''}`),
  }),
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, accept: boolean) => void,
  ) => {
    if (!extensions[file.mimetype]) {
      callback(
        new BadRequestException(
          'Only JPEG, PNG, and WebP evidence is allowed.',
        ),
        false,
      );
      return;
    }
    callback(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
};

export const publicDisputeUrl = (file: Express.Multer.File) =>
  `/uploads/disputes/${file.filename}`;
