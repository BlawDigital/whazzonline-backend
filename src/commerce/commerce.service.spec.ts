import { GoodsInvoicesService } from '../invoices/goods-invoices.service';
import { BadRequestException } from '@nestjs/common';

jest.mock('prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { CommerceService } from './commerce.service';

describe('CommerceService trust reviews', () => {
  const prisma = {
    $transaction: jest.fn(),
    commerceCartItem: { deleteMany: jest.fn(), findMany: jest.fn() },
    commerceOrder: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    product: { findFirst: jest.fn() },
    sellerFulfillment: { create: jest.fn() },
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

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (operation: (transaction: typeof prisma) => unknown) =>
        operation(prisma),
    );
  });

  it('does not expose database-only fields in order item responses', async () => {
    prisma.commerceCartItem.findMany.mockResolvedValue([]);
    prisma.commerceOrder.findMany.mockResolvedValue([
      {
        completedAt: new Date('2026-09-13T10:00:00.000Z'),
        createdAt: new Date('2026-09-13T09:00:00.000Z'),
        deliveryAddress: 'Ikeja, Lagos',
        deliveryFee: 13,
        id: 'order-id',
        issues: [],
        items: [
          {
            createdAt: new Date('2026-09-13T09:00:00.000Z'),
            deliveryAddress: 'Ikeja, Lagos',
            id: 'order-item-id',
            imageUri: 'https://example.com/product.jpg',
            name: 'Product',
            orderId: 'order-id',
            originalPrice: null,
            productId: 'product-id',
            quantity: 1,
            selectedColor: null,
            selectedSize: null,
            selectedVariants: {},
            sku: 'WHAZ-123456',
            subtitle: 'Fashion',
            unitPrice: 2_000,
            vendorId: 'vendor-id',
            vendorName: 'Vendor',
          },
        ],
        returnRequests: [],
        serviceFee: 6,
        status: 'delivered',
        subtotal: 2_000,
        total: 2_019,
        trustReviews: [],
      },
    ]);

    const snapshot = await service.snapshot('buyer-id');
    const item = snapshot.completedOrders[0]?.items[0];
    expect(item).not.toHaveProperty('createdAt');
    expect(item).not.toHaveProperty('orderId');
    expect(item).toMatchObject({
      id: 'order-item-id',
      productId: 'product-id',
    });
  });

  it('checks out the exact visible cart rows without rejecting a stale count', async () => {
    prisma.commerceCartItem.findMany.mockResolvedValue([
      {
        deliveryAddress: 'Ikeja, Lagos',
        id: 'cart-item-id',
        imageUri: 'https://example.com/item.jpg',
        name: 'Old display name',
        originalPrice: null,
        productId: 'product-id',
        quantity: 1,
        selectedColor: null,
        selectedSize: null,
        selectedVariants: {},
        sku: 'old-sku',
        subtitle: 'Fashion',
        unitPrice: 1,
        userId: 'buyer-id',
        vendorId: 'vendor-id',
        vendorName: 'Vendor',
        product: {
          category: 'Fashion',
          id: 'product-id',
          imageUrls: ['https://example.com/current.jpg'],
          name: 'Current product name',
          promoEndsAt: null,
          promoPrice: null,
          promoStartsAt: null,
          quantity: 5,
          status: 'ACTIVE',
          unitPrice: 12_000_000,
          vendorProfile: {
            user: { isActive: true },
            setupCompleted: true,
            storeName: 'Vendor',
            userId: 'vendor-id',
          },
        },
      },
    ]);
    const invoiceService = {
      resume: jest.fn().mockResolvedValue(null),
      createCheckout: jest.fn().mockResolvedValue({
        id: 'order-id',
        paymentStatus: 'pending',
        total: 24000000,
        invoices: [],
      }),
    };
    const checkoutService = new CommerceService(
      prisma as never,
      invoiceService as unknown as GoodsInvoicesService,
    );
    await expect(
      checkoutService.checkout('buyer-id', {
        address: { label: 'Ikeja, Lagos', latitude: 6.6, longitude: 3.35 },
        itemCount: 999,
        cartSelection: [{ cartItemId: 'cart-item-id', quantity: 2 }],
        paymentMethod: 'bank',
      }),
    ).resolves.toMatchObject({
      id: 'order-id',
      paymentStatus: 'pending',
      total: 24000000,
    });
    expect(invoiceService.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryFee: 0,
        lines: [
          expect.objectContaining({
            quantity: 2,
            unitPrice: 12000000,
            vendorId: 'vendor-id',
          }),
        ],
      }),
    );
  });
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
