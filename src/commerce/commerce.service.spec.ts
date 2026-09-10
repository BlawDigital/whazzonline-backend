import { BadRequestException } from '@nestjs/common';

jest.mock('prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { CommerceService } from './commerce.service';

describe('CommerceService trust reviews', () => {
  const prisma = {
    commerceOrder: { findFirst: jest.fn() },
    product: { findFirst: jest.fn() },
    productLike: {
      count: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    vendorProfile: { findUnique: jest.fn() },
    vendorTrustReview: {
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const service = new CommerceService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('persists one trust reason for a delivered vendor order', async () => {
    prisma.commerceOrder.findFirst.mockResolvedValue({
      id: 'order-id',
      items: [{ vendorId: 'vendor-id' }],
      status: 'delivered',
    });
    prisma.vendorProfile.findUnique.mockResolvedValue({ id: 'profile-id' });
    prisma.vendorTrustReview.findUnique.mockResolvedValue(null);
    prisma.vendorTrustReview.create.mockResolvedValue({
      createdAt: new Date('2026-09-09T12:00:00.000Z'),
      id: 'review-id',
      orderId: 'order-id',
      reason: 'The product arrived exactly as described.',
    });
    prisma.vendorTrustReview.count.mockResolvedValue(4);

    await expect(
      service.createTrustReview('buyer-id', {
        orderId: 'order-id',
        reason: '  The product arrived exactly as described.  ',
        vendorId: 'vendor-id',
      }),
    ).resolves.toMatchObject({
      id: 'review-id',
      reason: 'The product arrived exactly as described.',
      trustCount: 4,
      vendorId: 'vendor-id',
    });
    expect(prisma.vendorTrustReview.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-id',
        reason: 'The product arrived exactly as described.',
        reviewerUserId: 'buyer-id',
        vendorProfileId: 'profile-id',
      },
    });
  });

  it('rejects trust reviews before delivery', async () => {
    prisma.commerceOrder.findFirst.mockResolvedValue({
      id: 'order-id',
      items: [{ vendorId: 'vendor-id' }],
      status: 'in-transit',
    });

    await expect(
      service.createTrustReview('buyer-id', {
        orderId: 'order-id',
        reason: 'The seller communicated clearly.',
        vendorId: 'vendor-id',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vendorTrustReview.create).not.toHaveBeenCalled();
  });

  it('rejects a seller that was not part of the order', async () => {
    prisma.commerceOrder.findFirst.mockResolvedValue({
      id: 'order-id',
      items: [{ vendorId: 'different-vendor' }],
      status: 'delivered',
    });

    await expect(
      service.createTrustReview('buyer-id', {
        orderId: 'order-id',
        reason: 'The seller communicated clearly.',
        vendorId: 'vendor-id',
      }),
    ).rejects.toThrow('not part of the selected order');
  });

  it('rejects a duplicate review for the same vendor and order', async () => {
    prisma.commerceOrder.findFirst.mockResolvedValue({
      id: 'order-id',
      items: [{ vendorId: 'vendor-id' }],
      status: 'delivered',
    });
    prisma.vendorProfile.findUnique.mockResolvedValue({ id: 'profile-id' });
    prisma.vendorTrustReview.findUnique.mockResolvedValue({ id: 'review-id' });

    await expect(
      service.createTrustReview('buyer-id', {
        orderId: 'order-id',
        reason: 'The seller communicated clearly.',
        vendorId: 'vendor-id',
      }),
    ).rejects.toThrow('already reviewed this seller');
  });

  it('persists a product love and returns the current count', async () => {
    prisma.product.findFirst.mockResolvedValue({ id: 'product-id' });
    prisma.productLike.upsert.mockResolvedValue({ id: 'like-id' });
    prisma.productLike.count.mockResolvedValue(3);

    await expect(
      service.likeProduct('buyer-id', 'product-id'),
    ).resolves.toEqual({
      liked: true,
      likeCount: 3,
      productId: 'product-id',
    });
    expect(prisma.productLike.upsert).toHaveBeenCalledWith({
      where: {
        userId_productId: { productId: 'product-id', userId: 'buyer-id' },
      },
      create: { productId: 'product-id', userId: 'buyer-id' },
      update: {},
    });
  });

  it('removes a product love idempotently', async () => {
    prisma.productLike.deleteMany.mockResolvedValue({ count: 1 });
    prisma.productLike.count.mockResolvedValue(2);

    await expect(
      service.unlikeProduct('buyer-id', 'product-id'),
    ).resolves.toEqual({
      liked: false,
      likeCount: 2,
      productId: 'product-id',
    });
  });
});
