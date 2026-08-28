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

export const vendorUploadRoot = resolve(process.env.UPLOAD_DIR ?? 'uploads');
export const vendorUploadDirectory = join(vendorUploadRoot, 'vendors');

export const vendorUploadOptions = {
  storage: diskStorage({
    destination: (_request, _file, callback) => {
      mkdirSync(vendorUploadDirectory, { recursive: true });
      callback(null, vendorUploadDirectory);
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
    files: 2,
  },
};

export function publicVendorUploadUrl(file: Express.Multer.File) {
  return `/uploads/vendors/${file.filename}`;
}

export function removeUploadedFiles(files: Express.Multer.File[]) {
  for (const file of files) {
    try {
      unlinkSync(file.path);
    } catch {
      // The request error is more useful than a best-effort cleanup failure.
    }
  }
}

export function removeVendorUploadUrl(url?: string | null) {
  if (!url?.startsWith('/uploads/vendors/')) return;
  try {
    unlinkSync(join(vendorUploadDirectory, url.split('/').pop()!));
  } catch {
    // Replacing an image must still succeed if the old file is already absent.
  }
}
