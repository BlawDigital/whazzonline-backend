import { ForbiddenException } from '@nestjs/common';
import { MerchantService } from './merchant.service';
import { PrismaService } from 'prisma/prisma.service';
import { uploadMerchantMedia } from './merchant-media';
import { cloudinaryClient } from '../storage/cloudinary-storage';

jest.mock('prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('./merchant-media', () => ({ uploadMerchantMedia: jest.fn() }));
jest.mock('../storage/cloudinary-storage', () => ({
  cloudinaryClient: jest.fn(),
}));

describe('merchant persistence and permissions', () => {
  const prisma = {
    vendorProfile: { findUnique: jest.fn() },
    merchantContact: { findMany: jest.fn(), upsert: jest.fn() },
    vendorTrustReview: { findMany: jest.fn() },
    merchantContent: {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    vendorCategory: { findFirst: jest.fn(), create: jest.fn() },
    product: { findFirst: jest.fn(), update: jest.fn() },
    commerceOrderItem: { findFirst: jest.fn() },
    productReview: { upsert: jest.fn() },
  };
  const service = new MerchantService(prisma as unknown as PrismaService);
  const merchant = {
    id: 'profile',
    userId: 'merchant',
    setupCompleted: true,
    user: { registrationType: 'BUSINESS', role: 'BUSINESS', isActive: true },
  };
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.vendorProfile.findUnique.mockResolvedValue(merchant);
  });

  it('denies edits to another merchant Story before uploading media', async () => {
    prisma.merchantContent.findUnique.mockResolvedValue({
      merchant: { userId: 'other' },
    });
    await expect(
      service.updateContent(
        'merchant',
        'story',
        { title: 'New title' },
        {} as Express.Multer.File,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(uploadMerchantMedia).not.toHaveBeenCalled();
    expect(prisma.merchantContent.update).not.toHaveBeenCalled();
  });

  it('edits persisted story text without requiring a fresh upload', async () => {
    prisma.merchantContent.findUnique.mockResolvedValue({
      merchant: { userId: 'merchant' },
      kind: 'STORY',
    });
    prisma.merchantContent.update.mockResolvedValue({
      id: 'story',
      title: 'Fresh arrival',
    });
    await expect(
      service.updateContent('merchant', 'story', {
        title: '  Fresh arrival  ',
        caption: '',
        topic: 'NEW_IN',
      }),
    ).resolves.toMatchObject({ id: 'story' });
    expect(prisma.merchantContent.update).toHaveBeenCalledWith({
      where: { id: 'story' },
      data: { title: 'Fresh arrival', caption: '', topic: 'NEW_IN' },
    });
    expect(uploadMerchantMedia).not.toHaveBeenCalled();
    await expect(
      service.updateContent('merchant', 'story', { title: '  ' }),
    ).rejects.toThrow('at least two');
  });

  it('removes replaced media after save and rolls back a fresh upload on database failure', async () => {
    const destroy = jest.fn().mockResolvedValue({});
    jest
      .mocked(cloudinaryClient)
      .mockReturnValue({ uploader: { destroy } } as unknown as ReturnType<
        typeof cloudinaryClient
      >);
    prisma.merchantContent.findUnique.mockResolvedValue({
      merchant: { userId: 'merchant' },
      kind: 'STORY',
      mediaPublicId: 'old',
      mediaType: 'IMAGE',
    });
    jest
      .mocked(uploadMerchantMedia)
      .mockResolvedValue({
        mediaUrl: 'https://media.example/new.mp4',
        mediaType: 'VIDEO',
        publicId: 'new',
        resourceType: 'video',
      });
    prisma.merchantContent.update.mockResolvedValue({ id: 'story' });
    const file = { mimetype: 'video/mp4' } as Express.Multer.File;
    await service.updateContent('merchant', 'story', {}, file);
    expect(destroy).toHaveBeenCalledWith('old', { resource_type: 'image' });
    destroy.mockClear();
    prisma.merchantContent.update.mockRejectedValue(
      new Error('Database unavailable'),
    );
    await expect(
      service.updateContent('merchant', 'story', {}, file),
    ).rejects.toThrow('Database unavailable');
    expect(destroy).toHaveBeenCalledWith('new', { resource_type: 'video' });
    expect(destroy).not.toHaveBeenCalledWith('old', expect.anything());
  });

  it('saves an idempotent database contact and rejects self contacts', async () => {
    await service.saveContact('buyer', 'merchant');
    expect(prisma.merchantContact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_merchantId: { userId: 'buyer', merchantId: 'profile' },
        },
      }),
    );
    await expect(service.saveContact('merchant', 'merchant')).rejects.toThrow(
      'yourself',
    );
  });

  it('paginates saved and trusted merchants before discovery and strips upload identifiers', async () => {
    prisma.merchantContact.findMany.mockResolvedValue([
      { merchantId: 'saved' },
    ]);
    prisma.vendorTrustReview.findMany.mockResolvedValue([
      { vendorProfileId: 'trusted' },
    ]);
    prisma.merchantContent.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    prisma.merchantContent.findMany
      .mockResolvedValueOnce([
        { id: 'a', merchantId: 'saved', mediaPublicId: 'private' },
      ])
      .mockResolvedValueOnce([
        { id: 'b', merchantId: 'other', mediaPublicId: 'private' },
      ]);
    const result = await service.feed('buyer', {
      kind: 'SCROLL',
      offset: 0,
      limit: 2,
    });
    expect(result.items.map((row) => row.id)).toEqual(['a', 'b']);
    expect(result.items[0]).toMatchObject({ saved: true, trusted: true });
    expect(result.items[0]).not.toHaveProperty('mediaPublicId');
    expect(prisma.merchantContent.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ merchantId: { notIn: ['saved', 'trusted'] } }],
        }) as unknown,
        take: 1,
      }),
    );
  });

  it('allows all business accounts to create SCROLL but denies vendors before upload', async () => {
    prisma.vendorProfile.findUnique.mockResolvedValue({
      ...merchant,
      user: { registrationType: 'SELLER', role: 'VENDOR', isActive: true },
    });
    await expect(
      service.createContent('merchant', { kind: 'SCROLL', title: 'A guide' }),
    ).rejects.toThrow(ForbiddenException);
    prisma.vendorProfile.findUnique.mockResolvedValue(merchant);
    await expect(
      service.createContent('merchant', { kind: 'SCROLL', title: 'A guide' }),
    ).rejects.toThrow('Add a media file');
  });

  it('requires a business for nested aisles and rejects cross-store assignments', async () => {
    prisma.vendorProfile.findUnique.mockResolvedValue({
      ...merchant,
      user: { registrationType: 'SELLER', role: 'VENDOR', isActive: true },
    });
    await expect(
      service.createAisle('merchant', { name: 'Kitchen', parentId: 'parent' }),
    ).rejects.toThrow('business account');
    prisma.vendorProfile.findUnique.mockResolvedValue(merchant);
    prisma.product.findFirst.mockResolvedValue({ id: 'product' });
    prisma.vendorCategory.findFirst.mockResolvedValue(null);
    await expect(
      service.assignAisle('merchant', 'product', 'other-store'),
    ).rejects.toThrow('own store');
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('persists a business video upload without a premium-account requirement', async () => {
    const file = {
      mimetype: 'video/mp4',
      buffer: Buffer.from('fixture'),
    } as Express.Multer.File;
    jest.mocked(uploadMerchantMedia).mockResolvedValue({
      mediaUrl: 'https://media.example/guide.mp4',
      mediaType: 'VIDEO',
      publicId: 'media-id',
      resourceType: 'video',
    });
    prisma.merchantContent.create.mockResolvedValue({ id: 'guide' });
    await expect(
      service.createContent(
        'merchant',
        {
          kind: 'SCROLL',
          topic: 'FAQ',
          title: '  Product answers  ',
          caption: '  Helpful details  ',
        },
        file,
      ),
    ).resolves.toEqual({ id: 'guide' });
    expect(prisma.merchantContent.create).toHaveBeenCalledWith({
      data: {
        merchantId: 'profile',
        kind: 'SCROLL',
        topic: 'FAQ',
        title: 'Product answers',
        caption: 'Helpful details',
        mediaUrl: 'https://media.example/guide.mp4',
        mediaType: 'VIDEO',
        mediaPublicId: 'media-id',
      },
    });
  });

  it('requires delivered ownership for a rated comment and rejects merchant self-review', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'product',
      vendorProfile: { userId: 'merchant' },
    });
    await expect(
      service.review('merchant', 'product', {
        rating: 5,
        comment: 'Good product',
      }),
    ).rejects.toThrow('own product');
    prisma.commerceOrderItem.findFirst.mockResolvedValue(null);
    await expect(
      service.review('buyer', 'product', {
        rating: 5,
        comment: 'Good product',
      }),
    ).rejects.toThrow('delivered purchase');
    prisma.commerceOrderItem.findFirst.mockResolvedValue({
      id: 'delivered-item',
    });
    await service.review('buyer', 'product', {
      rating: 5,
      comment: '  Good product  ',
    });
    expect(prisma.commerceOrderItem.findFirst).toHaveBeenLastCalledWith({
      where: {
        productId: 'product',
        order: { userId: 'buyer', status: 'delivered' },
      },
      select: { id: true },
    });
    expect(prisma.productReview.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { rating: 5, comment: 'Good product' },
      }),
    );
  });
});
