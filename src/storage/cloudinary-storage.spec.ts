import { v2 as cloudinary } from 'cloudinary';
import { Readable, Writable } from 'node:stream';
import {
  cloudinaryImageOptions,
  removeCloudinaryUrl,
  uploadCloudinary,
} from './cloudinary-storage';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=',
  'base64',
);
describe('Cloudinary storage', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
    process.env.CLOUDINARY_API_KEY = 'test-key';
    process.env.CLOUDINARY_API_SECRET = 'test-secret';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...original };
  });
  it('rejects spoofed content before contacting Cloudinary', async () => {
    const spy = jest.spyOn(cloudinary.uploader, 'upload_stream');
    await expect(
      uploadCloudinary(Buffer.from('not an image'), 'image/png', 'products'),
    ).rejects.toThrow('File content');
    expect(spy).not.toHaveBeenCalled();
  });
  it('fails closed when Cloudinary is not configured', async () => {
    delete process.env.CLOUDINARY_API_SECRET;
    await expect(uploadCloudinary(png, 'image/png', 'users')).rejects.toThrow(
      'not configured',
    );
  });
  it('does not delete foreign accounts or assets outside our namespace', async () => {
    const spy = jest.spyOn(cloudinary.uploader, 'destroy');
    await removeCloudinaryUrl(
      'https://res.cloudinary.com/other/image/upload/whazzonline/users/id.png',
    );
    await removeCloudinaryUrl(
      'https://res.cloudinary.com/test-cloud/image/upload/unrelated.png',
    );
    await removeCloudinaryUrl('/uploads/users/old.png');
    expect(spy).not.toHaveBeenCalled();
  });
  it('deletes the correct private asset after a failed save', async () => {
    const spy = jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });
    await removeCloudinaryUrl(
      'https://res.cloudinary.com/test-cloud/image/authenticated/s--signature--/v123/whazzonline/chat/id.png',
    );
    expect(spy).toHaveBeenCalledWith('whazzonline/chat/id', {
      type: 'authenticated',
      invalidate: true,
    });
  });
  it.each([
    ['products', 'images', 'upload'],
    ['users', 'avatar', 'upload'],
    ['vendors', 'logo', 'upload'],
    ['vendors', 'cac', 'authenticated'],
    ['chat', 'file', 'authenticated'],
    ['disputes', 'evidence', 'authenticated'],
  ])(
    'stores %s/%s with the required delivery type',
    async (folder, fieldname, type) => {
      const spy = jest
        .spyOn(cloudinary.uploader, 'upload_stream')
        .mockImplementation((...args: unknown[]) => {
          const callback = args[1] as (error: unknown, result: unknown) => void;
          return new Writable({
            write(_chunk, _encoding, done) {
              done();
            },
            final(done) {
              callback(undefined, {
                secure_url:
                  'https://res.cloudinary.com/test-cloud/image/upload/whazzonline/test.png',
                public_id: 'whazzonline/test',
                version: 123,
                format: 'png',
              });
              done();
            },
          }) as never;
        });
      const options = cloudinaryImageOptions(folder, 1);
      const file = {
        fieldname,
        mimetype: 'image/png',
        stream: Readable.from(png),
      } as Express.Multer.File;
      await new Promise<void>((resolve, reject) =>
        options.storage._handleFile({} as never, file, (error) =>
          error
            ? reject(
                error instanceof Error ? error : new Error('Upload failed.'),
              )
            : resolve(),
        ),
      );
      expect(spy.mock.calls[0][0]).toMatchObject({
        type,
        resource_type: 'image',
        overwrite: false,
      });
    },
  );
});
