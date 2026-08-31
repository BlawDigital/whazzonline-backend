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

const productUploadRoot = resolve(process.env.UPLOAD_DIR ?? 'uploads');
const productUploadDirectory = join(productUploadRoot, 'products');

export const productUploadOptions = {
  storage: diskStorage({
    destination: (_request, _file, callback) => {
      mkdirSync(productUploadDirectory, { recursive: true });
      callback(null, productUploadDirectory);
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
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 5,
  },
};

export function publicProductUploadUrl(file: Express.Multer.File) {
  return `/uploads/products/${file.filename}`;
}

export function removeProductUploads(files: Express.Multer.File[]) {
  for (const file of files) {
    try {
      unlinkSync(file.path);
    } catch {
      // Best-effort cleanup must not hide the original request error.
    }
  }
}
