import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const uploadRoot = resolve(process.env.UPLOAD_DIR ?? 'uploads');
const uploadDirectory = join(uploadRoot, 'users');

export const userUploadOptions = {
  storage: diskStorage({
    destination: (_request, _file, callback) => {
      mkdirSync(uploadDirectory, { recursive: true });
      callback(null, uploadDirectory);
    },
    filename: (_request, file, callback) => {
      const extension =
        MIME_EXTENSIONS[file.mimetype] ?? extname(file.originalname);
      callback(null, `${randomUUID()}${extension.toLowerCase()}`);
    },
  }),
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!MIME_EXTENSIONS[file.mimetype]) {
      callback(
        new BadRequestException('Only PNG, JPEG, and WebP images are allowed.'),
        false,
      );
      return;
    }
    callback(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
};

export function publicUserUploadUrl(file: Express.Multer.File) {
  return `/uploads/users/${file.filename}`;
}

export function removeUploadedFile(file: Express.Multer.File) {
  try {
    unlinkSync(file.path);
  } catch {
    /* Best-effort cleanup after a failed save. */
  }
}

export function removeUserUploadUrl(url?: string | null) {
  if (!url?.startsWith('/uploads/users/')) return;
  try {
    unlinkSync(join(uploadDirectory, url.split('/').pop()!));
  } catch {
    /* Old file may already be absent. */
  }
}
