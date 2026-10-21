import { BadGatewayException, BadRequestException } from '@nestjs/common';
import {
  cloudinaryClient,
  validFileSignature,
} from '../storage/cloudinary-storage';
import { randomUUID } from 'node:crypto';

export function validMerchantMedia(buffer: Buffer, mime: string) {
  if (mime.startsWith('image/')) return validFileSignature(buffer, mime);
  if (mime === 'video/mp4' || mime === 'video/quicktime')
    return buffer.toString('ascii', 4, 8) === 'ftyp';
  return (
    mime === 'video/webm' &&
    buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  );
}
export async function uploadMerchantMedia(file: Express.Multer.File) {
  if (!validMerchantMedia(file.buffer, file.mimetype))
    throw new BadRequestException(
      'Choose a JPEG, PNG, WebP, MP4, MOV or WebM file.',
    );
  const resourceType = file.mimetype.startsWith('video/') ? 'video' : 'image';
  const publicId = `whazzonline/merchant-content/${randomUUID()}`;
  const result = await new Promise<{ secure_url: string }>(
    (resolve, reject) => {
      const stream = cloudinaryClient().uploader.upload_stream(
        {
          resource_type: resourceType,
          public_id: publicId,
          overwrite: false,
          timeout: 60000,
        },
        (error, value) => {
          if (error || !value)
            reject(
              new BadGatewayException('Media upload failed. Please try again.'),
            );
          else resolve(value);
        },
      );
      stream.on('error', () =>
        reject(new BadGatewayException('Media upload failed.')),
      );
      stream.end(file.buffer);
    },
  );
  return {
    mediaUrl: result.secure_url,
    mediaType: resourceType.toUpperCase(),
    publicId,
    resourceType,
  };
}

export async function uploadStoryMusic(file: Express.Multer.File) {
  const b = file.buffer;
  const valid = (file.mimetype === 'audio/mpeg' && (b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))) || (['audio/mp4', 'audio/x-m4a'].includes(file.mimetype) && b.toString('ascii', 4, 8) === 'ftyp') || (['audio/wav', 'audio/x-wav'].includes(file.mimetype) && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') || (file.mimetype === 'audio/ogg' && b.toString('ascii', 0, 4) === 'OggS');
  if (!valid || b.length > 10 * 1024 * 1024) throw new BadRequestException('Choose an MP3, M4A, WAV or OGG file smaller than 10 MB.');
  const publicId = `whazzonline/story-music/${randomUUID()}`;
  const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
    const stream = cloudinaryClient().uploader.upload_stream({ resource_type: 'video', public_id: publicId, overwrite: false, timeout: 60000 }, (error, value) => error || !value ? reject(new BadGatewayException('Music upload failed. Please retry.')) : resolve(value));
    stream.on('error', () => reject(new BadGatewayException('Music upload failed.'))); stream.end(b);
  });
  return { url: result.secure_url, publicId };
}
