import { validMerchantMedia } from './merchant-media';
describe('merchant media signatures', () => {
  it('rejects mislabeled media before upload', () => {
    expect(
      validMerchantMedia(Buffer.from('<script>bad</script>'), 'video/mp4'),
    ).toBe(false);
    expect(validMerchantMedia(Buffer.from('not an image'), 'image/png')).toBe(
      false,
    );
    expect(validMerchantMedia(Buffer.from('<svg/>'), 'image/svg+xml')).toBe(
      false,
    );
  });
  it('recognizes MP4, MOV and WebM headers', () => {
    const mp4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]);
    expect(validMerchantMedia(mp4, 'video/mp4')).toBe(true);
    expect(validMerchantMedia(mp4, 'video/quicktime')).toBe(true);
    expect(
      validMerchantMedia(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'video/webm'),
    ).toBe(true);
    expect(validMerchantMedia(mp4, 'application/octet-stream')).toBe(false);
  });
});
