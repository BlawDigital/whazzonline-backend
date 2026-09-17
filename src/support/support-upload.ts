import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export type SupportAttachment = { id: string; name: string; mimeType: string; size: number };
const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export const supportUploadRoot = () => `${resolve(process.env.UPLOAD_DIR ?? 'uploads')}-support-private`;
export const supportUploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 1, fieldSize: 16000, parts: 4 },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) => {
    if (!allowed.includes(file.mimetype)) return cb(new BadRequestException('Only JPEG, PNG, WebP and PDF attachments are supported.'), false);
    cb(null, true);
  },
};

function validSignature(file: Express.Multer.File) {
  const b = file.buffer;
  if (!b?.length) return false;
  if (file.mimetype === 'image/jpeg') return b.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (file.mimetype === 'image/png') return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/webp') return b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  return file.mimetype === 'application/pdf' && b.toString('ascii', 0, 5) === '%PDF-';
}

export async function removeSupportAttachments(files: SupportAttachment[]) {
  await Promise.all(files.map(file => unlink(join(supportUploadRoot(), file.id)).catch(() => undefined)));
}

export async function saveSupportAttachments(files: Express.Multer.File[]): Promise<SupportAttachment[]> {
  if (files.length > 3 || files.some(file => file.size > 5 * 1024 * 1024 || !validSignature(file))) {
    throw new BadRequestException('Invalid attachment. Use up to three JPEG, PNG, WebP or PDF files, at most 5 MB each.');
  }
  const saved: SupportAttachment[] = [];
  if (!files.length) return saved;
  await mkdir(supportUploadRoot(), { recursive: true });
  try {
    for (const file of files) {
      const attachment = { id: randomUUID(), name: basename(file.originalname).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || 'Attachment', mimeType: file.mimetype, size: file.buffer.length };
      saved.push(attachment);
      await writeFile(join(supportUploadRoot(), attachment.id), file.buffer, { flag: 'wx', mode: 0o600 });
    }
    return saved;
  } catch (error) {
    await removeSupportAttachments(saved);
    throw error;
  }
}

export function parseSupportAttachments(value: unknown): SupportAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SupportAttachment => !!item && typeof item === 'object' &&
    typeof item.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id) &&
    typeof item.name === 'string' && typeof item.mimeType === 'string' &&
    allowed.includes(item.mimeType) && typeof item.size === 'number');
}

export const readSupportAttachment = (file: SupportAttachment) => readFile(join(supportUploadRoot(), file.id));
