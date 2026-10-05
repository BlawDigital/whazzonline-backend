import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import {
  cloudinaryClient,
  uploadCloudinary,
} from '../storage/cloudinary-storage';
import { basename, join, resolve } from 'node:path';

export type SupportAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  cloudinary?: {
    publicId: string;
    resourceType: 'image' | 'raw';
    format: string;
  };
};
const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export const supportUploadRoot = () =>
  `${resolve(process.env.UPLOAD_DIR ?? 'uploads')}-support-private`;
export const supportUploadOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 3,
    fields: 1,
    fieldSize: 16000,
    parts: 4,
  },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    cb: (error: Error | null, accept: boolean) => void,
  ) => {
    if (!allowed.includes(file.mimetype))
      return cb(
        new BadRequestException(
          'Only JPEG, PNG, WebP and PDF attachments are supported.',
        ),
        false,
      );
    cb(null, true);
  },
};

function validSignature(file: Express.Multer.File) {
  const b = file.buffer;
  if (!b?.length) return false;
  if (file.mimetype === 'image/jpeg')
    return b.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (file.mimetype === 'image/png')
    return b
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/webp')
    return (
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP'
    );
  return (
    file.mimetype === 'application/pdf' && b.toString('ascii', 0, 5) === '%PDF-'
  );
}

export async function removeSupportAttachments(files: SupportAttachment[]) {
  await Promise.all(
    files.map((file) =>
      file.cloudinary
        ? cloudinaryClient()
            .uploader.destroy(file.cloudinary.publicId, {
              resource_type: file.cloudinary.resourceType,
              type: 'authenticated',
              invalidate: true,
            })
            .catch(() => undefined)
        : unlink(join(supportUploadRoot(), file.id)).catch(() => undefined),
    ),
  );
}

export async function saveSupportAttachments(
  files: Express.Multer.File[],
): Promise<SupportAttachment[]> {
  if (
    files.length > 3 ||
    files.some((file) => file.size > 5 * 1024 * 1024 || !validSignature(file))
  ) {
    throw new BadRequestException(
      'Invalid attachment. Use up to three JPEG, PNG, WebP or PDF files, at most 5 MB each.',
    );
  }
  const saved: SupportAttachment[] = [];
  if (!files.length) return saved;
  try {
    for (const file of files) {
      const attachment: SupportAttachment = {
        id: randomUUID(),
        name:
          basename(file.originalname)
            .split('')
            .filter(
              (character) =>
                character.charCodeAt(0) >= 32 &&
                character.charCodeAt(0) !== 127,
            )
            .join('')
            .slice(0, 160) || 'Attachment',
        mimeType: file.mimetype,
        size: file.buffer.length,
      };
      const result = await uploadCloudinary(
        file.buffer,
        file.mimetype,
        'support',
        true,
        attachment.id,
      );
      attachment.cloudinary = {
        publicId: result.public_id,
        resourceType: result.resource_type as 'image' | 'raw',
        format: result.format ?? '',
      };
      saved.push(attachment);
    }
    return saved;
  } catch (error) {
    await removeSupportAttachments(saved);
    throw error;
  }
}

export function parseSupportAttachments(value: unknown): SupportAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item: unknown): item is SupportAttachment => {
    if (!item || typeof item !== 'object') return false;
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(entry.id) ||
      typeof entry.name !== 'string' ||
      typeof entry.mimeType !== 'string' ||
      !allowed.includes(entry.mimeType) ||
      typeof entry.size !== 'number'
    )
      return false;
    if (entry.cloudinary !== undefined) {
      if (!entry.cloudinary || typeof entry.cloudinary !== 'object')
        return false;
      const cloud = entry.cloudinary as Record<string, unknown>;
      if (
        typeof cloud.publicId !== 'string' ||
        !/^whazzonline\/support\/[0-9a-f-]{36}(?:\.pdf)?$/i.test(
          cloud.publicId,
        ) ||
        !['image', 'raw'].includes(String(cloud.resourceType)) ||
        typeof cloud.format !== 'string'
      )
        return false;
    }
    return true;
  });
}

export async function readSupportAttachment(file: SupportAttachment) {
  // Existing private files remain readable until the transfer script is run.
  if (!file.cloudinary) return readFile(join(supportUploadRoot(), file.id));
  const url = cloudinaryClient().utils.private_download_url(
    file.cloudinary.publicId,
    file.cloudinary.format,
    {
      resource_type: file.cloudinary.resourceType,
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + 60,
    },
  );
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok)
    throw new BadRequestException('Unable to download this attachment.');
  return Buffer.from(await response.arrayBuffer());
}
