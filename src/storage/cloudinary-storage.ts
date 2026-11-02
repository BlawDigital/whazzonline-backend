import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { randomUUID } from 'node:crypto';
import type { StorageEngine } from 'multer';

export function cloudinaryClient() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET)
    throw new ServiceUnavailableException('Cloud storage is not configured.');
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  return cloudinary;
}

export function validFileSignature(buffer: Buffer, mime: string) {
  if (mime === 'video/mp4' || mime === 'video/quicktime')
    return buffer.toString('ascii', 4, 8) === 'ftyp';
  if (mime === 'video/webm')
    return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mime === 'image/png')
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg')
    return buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mime === 'image/webp')
    return (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  return (
    mime === 'application/pdf' && buffer.toString('ascii', 0, 5) === '%PDF-'
  );
}

export async function uploadCloudinary(
  buffer: Buffer,
  mime: string,
  folder: string,
  privateAsset = false,
  id: string = randomUUID(),
): Promise<UploadApiResponse> {
  if (!validFileSignature(buffer, mime))
    throw new BadRequestException(
      'File content does not match its image or document type.',
    );
  const client = cloudinaryClient();
  const video = mime.startsWith('video/');
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      {
        public_id: `whazzonline/${folder}/${id}${mime === 'application/pdf' ? '.pdf' : ''}`,
        resource_type: video ? 'video' : mime === 'application/pdf' ? 'raw' : 'image',
        ...(video ? { transformation: [{ audio_codec: 'none' }], format: 'mp4' } : {}),
        type: privateAsset ? 'authenticated' : 'upload',
        overwrite: false,
        timeout: 60000,
      },
      (error, result) => {
        if (error || !result)
          reject(
            new BadGatewayException('Cloud upload failed. Please try again.'),
          );
        else if (video && (!Number.isFinite(result.duration) || result.duration <= 0 || result.duration > 7.1 || !result.width || !result.height)) {
          void client.uploader.destroy(result.public_id, { resource_type: 'video', invalidate: true })
            .catch(() => undefined)
            .finally(() => reject(new BadRequestException('Product videos must be no longer than 7 seconds.')));
        } else resolve(result);
      },
    );
    stream.on('error', () =>
      reject(new BadGatewayException('Cloud upload failed. Please try again.')),
    );
    stream.end(buffer);
  });
}

/** Only our own account and application namespace may be deleted. */
export async function removeCloudinaryUrl(value?: string | null) {
  if (!value) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  const resourceType = url.pathname.startsWith(`/${process.env.CLOUDINARY_CLOUD_NAME}/video/`) ? 'video' : 'image';
  const prefix = `/${process.env.CLOUDINARY_CLOUD_NAME}/${resourceType}/`;
  if (url.hostname !== 'res.cloudinary.com' || !url.pathname.startsWith(prefix))
    return;
  const path = url.pathname.slice(prefix.length);
  const type = path.startsWith('authenticated/') ? 'authenticated' : 'upload';
  if (!path.startsWith(`${type}/`)) return;
  const publicId = path
    .slice(type.length + 1)
    .replace(/^s--[^/]+--\//, '')
    .replace(/^v\d+\//, '')
    .replace(/\.[^./]+$/, '');
  if (!publicId.startsWith('whazzonline/')) return;
  await cloudinaryClient()
    .uploader.destroy(publicId, { type, invalidate: true, ...(resourceType === 'video' ? { resource_type: 'video' } : {}) })
    .catch(() => undefined);
}

export function cloudinaryImageOptions(folder: string, files: number, maxMB = 5, allowVideo = false) {
  const storage: StorageEngine = {
    _handleFile(_request, file, callback) {
      const chunks: Buffer[] = [];
      let size = 0;
      file.stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= maxMB * 1024 * 1024) chunks.push(chunk);
      });
      file.stream.on('error', callback);
      file.stream.on('end', () => {
        if (
          (file.stream as NodeJS.ReadableStream & { truncated?: boolean })
            .truncated ||
          size > maxMB * 1024 * 1024
        )
          return callback(
            new BadRequestException(`Files must be at most ${maxMB} MB.`),
          );
        const privateAsset =
          folder === 'chat' ||
          folder === 'disputes' ||
          file.fieldname === 'cac';
        void uploadCloudinary(
          Buffer.concat(chunks),
          file.mimetype,
          folder,
          privateAsset,
        )
          .then((result) => {
            const path = privateAsset
              ? cloudinaryClient().url(result.public_id, {
                  type: 'authenticated',
                  sign_url: true,
                  secure: true,
                  version: result.version,
                  format: result.format,
                })
              : result.secure_url;
            callback(null, { path, filename: result.public_id, size });
          })
          .catch(callback);
      });
    },
    _removeFile(_request, file, callback) {
      void removeCloudinaryUrl(file.path)
        .then(() => callback(null))
        .catch(callback);
    },
  };
  return {
    storage,
    limits: { fileSize: maxMB * 1024 * 1024, files },
    fileFilter: (
      _request: unknown,
      file: Express.Multer.File,
      callback: (error: Error | null, accept: boolean) => void,
    ) => {
      const video = allowVideo && file.fieldname === 'video';
      if (!(video ? ['video/mp4', 'video/webm', 'video/quicktime'] : ['image/jpeg', 'image/png', 'image/webp']).includes(file.mimetype))
        return callback(
          new BadRequestException(
            video ? 'Use an MP4, WebM, or MOV video.' : 'Only PNG, JPEG, and WebP images are allowed.',
          ),
          false,
        );
      callback(null, true);
    },
  };
}
