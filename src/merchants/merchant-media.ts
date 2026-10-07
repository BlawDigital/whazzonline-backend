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
