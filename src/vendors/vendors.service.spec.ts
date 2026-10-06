import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

jest.mock('prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { VendorsService } from './vendors.service';

describe('VendorsService', () => {
  const prisma = {
    commerceOrderItem: {
      findMany: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    vendorTrustReview: { groupBy: jest.fn().mockResolvedValue([]) },
    product: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    vendorCategory: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    wallet: { findUnique: jest.fn(), upsert: jest.fn() },
    walletTransaction: { create: jest.fn() },
    vendorProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const service = new VendorsService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('stores an initial promo in the same product write', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      id: 'profile-id',
      setupCompleted: true,
    });
    await service.createProduct(
      'vendor-id',
      {
        category: 'Watches',
        name: 'Watch',
        unitPrice: 10000,
        quantity: 3,
        variants: [],
        promoPrice: 8000,
        promoDurationHours: 72,
      } as never,
      ['/uploads/products/watch.png'],
    );
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        promoPrice: 8000,
        promoStartsAt: expect.any(Date),
        promoEndsAt: expect.any(Date),
      }),
    });
    const write = prisma.product.create.mock.calls[0][0].data;
    expect(write.promoEndsAt.getTime() - write.promoStartsAt.getTime()).toBe(
      72 * 3600000,
    );
  });

  it('rejects a non-discount promo before writing the product', async () => {
    await expect(
      service.createProduct(
        'vendor-id',
        { unitPrice: 100, promoPrice: 100 } as never,
        [],
      ),
    ).rejects.toThrow('lower');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('rejects buyer accounts from vendor setup', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'CUSTOMER' });

    await expect(
      service.saveProfile('buyer-id', {
        address: '1 Market Road',
        category: 'Fashion & Accessories',
        city: 'Ikeja',
        description: 'Clothing and shoes',
        lga: 'Ikeja',
        state: 'Lagos',
        storeName: 'Example Store',
        subCategory: 'Clothing',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('calculates vendor finance from delivered order items and payouts', async () => {
    prisma.user.findUnique.mockResolvedValue({
      firstName: 'Ada',
      lastName: 'Vendor',
      role: 'VENDOR',
    });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      bankAccountName: 'Ada Vendor',
      bankAccountNumber: '0123456789',
      bankCode: '011',
      bankName: 'First Bank',
      storeName: 'Ada Store',
    });
    prisma.commerceOrderItem.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-09-14T10:00:00.000Z'),
        id: 'item-id',
        orderId: 'order-123456',
        quantity: 2,
        unitPrice: 5000,
      },
    ]);
    prisma.wallet.upsert.mockResolvedValue({
      transactions: [
        {
          amount: -1000,
          createdAt: new Date(),
          id: 'payout-id',
          status: 'COMPLETED',
        },
      ],
    });

    await expect(service.finance('vendor-id')).resolves.toMatchObject({
      availableBalance: 8000,
      completedPayouts: 1000,
      grossSales: 10000,
      minimumWithdrawalAmount: 100,
      netEarnings: 9000,
      platformFees: 1000,
      totalSales: 10000,
    });
  });

  it('rejects a withdrawal larger than the available seller balance', async () => {
    jest.spyOn(service, 'finance').mockResolvedValueOnce({
      availableBalance: 500,
      bankAccount: { accountNumber: '0123456789', bankName: 'First Bank' },
    } as never);

    await expect(service.requestWithdrawal('vendor-id', 600)).rejects.toThrow(
      'Withdrawal exceeds available balance.',
    );
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
  });

  it('upserts a profile for a vendor account', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.vendorProfile.upsert.mockResolvedValue({ id: 'profile-id' });

    await service.saveProfile('vendor-id', {
      address: '1 Market Road',
      category: 'Fashion & Accessories',
      city: 'Ikeja',
      description: 'Clothing and shoes',
      lga: 'Ikeja',
      state: 'Lagos',
      storeName: 'Example Store',
      subCategory: 'Clothing',
    });

    expect(prisma.vendorProfile.upsert).toHaveBeenCalledWith({
      create: {
        address: '1 Market Road',
        category: 'Fashion & Accessories',
        city: 'Ikeja',
        description: 'Clothing and shoes',
        lga: 'Ikeja',
        state: 'Lagos',
        storeName: 'Example Store',
        subCategory: 'Clothing',
        userId: 'vendor-id',
      },
      update: {
        address: '1 Market Road',
        category: 'Fashion & Accessories',
        city: 'Ikeja',
        description: 'Clothing and shoes',
        lga: 'Ikeja',
        reviewStatus: 'DRAFT',
        setupCompleted: false,
        state: 'Lagos',
        storeName: 'Example Store',
        subCategory: 'Clothing',
        submittedAt: null,
        termsAcceptedAt: null,
      },
      where: { userId: 'vendor-id' },
    });
  });

  it('requires profile details before image upload', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'BUSINESS' });
    prisma.vendorProfile.findUnique.mockResolvedValue(null);

    await expect(
      service.saveIdentity('business-id', {
        logoUrl: '/uploads/vendors/logo.png',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps setup in draft after identity uploads', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      bannerUrl: '/uploads/vendors/banner.png',
      logoUrl: null,
    });
    prisma.vendorProfile.update.mockResolvedValue({ setupCompleted: false });

    await service.saveIdentity('vendor-id', {
      logoUrl: '/uploads/vendors/logo.png',
    });

    expect(prisma.vendorProfile.update).toHaveBeenCalledWith({
      data: {
        logoUrl: '/uploads/vendors/logo.png',
        reviewStatus: 'DRAFT',
        setupCompleted: false,
        submittedAt: null,
        termsAcceptedAt: null,
      },
      where: { userId: 'vendor-id' },
    });
  });

  it('stores validated payout details without completing setup', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.vendorProfile.findUnique.mockResolvedValue({ id: 'profile-id' });
    prisma.vendorProfile.update.mockResolvedValue({ setupCompleted: false });

    await service.saveBank('vendor-id', {
      accountName: 'Ada Vendor',
      accountNumber: '0123456789',
      bankCode: '011',
      bankName: 'First Bank of Nigeria',
    });

    expect(prisma.vendorProfile.update).toHaveBeenCalledWith({
      data: {
        bankAccountName: 'Ada Vendor',
        bankAccountNumber: '0123456789',
        bankCode: '011',
        bankName: 'First Bank of Nigeria',
        reviewStatus: 'DRAFT',
        setupCompleted: false,
        submittedAt: null,
        termsAcceptedAt: null,
      },
      where: { userId: 'vendor-id' },
    });
  });

  it('rejects submission until identity and payout details are complete', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      bannerUrl: '/uploads/vendors/banner.png',
      logoUrl: '/uploads/vendors/logo.png',
    });

    await expect(
      service.submitProfile('vendor-id', {
        sellerType: 'RETAILER',
        termsAccepted: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('submits a complete vendor profile for review', async () => {
    prisma.user.findUnique.mockResolvedValue({
      registrationType: 'SELLER',
      role: 'VENDOR',
    });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      bankAccountName: 'Ada Vendor',
      bankAccountNumber: '0123456789',
      bankCode: '011',
      bankName: 'First Bank of Nigeria',
      bannerUrl: '/uploads/vendors/banner.png',
      cacUrl: '/uploads/vendors/cac.png',
      logoUrl: '/uploads/vendors/logo.png',
    });
    prisma.vendorProfile.update.mockResolvedValue({
      reviewStatus: 'PENDING',
      setupCompleted: true,
    });

    await service.submitProfile('vendor-id', {
      sellerType: 'BOTH',
      termsAccepted: true,
    });

    expect(prisma.vendorProfile.update).toHaveBeenCalledWith({
      data: {
        reviewStatus: 'PENDING',
        sellerType: 'BOTH',
        setupCompleted: true,
        // Jest asymmetric matchers are intentionally typed as any.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        submittedAt: expect.any(Date),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        termsAcceptedAt: expect.any(Date),
      },
      where: { userId: 'vendor-id' },
    });
  });

  it('does not require a CAC document for an individual seller', async () => {
    prisma.user.findUnique.mockResolvedValue({
      registrationType: 'SELLER',
      role: 'VENDOR',
    });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      bankAccountName: 'Ada Vendor',
      bankAccountNumber: '0123456789',
      bankCode: '011',
      bankName: 'First Bank of Nigeria',
      bannerUrl: '/uploads/vendors/banner.png',
      cacUrl: null,
      logoUrl: '/uploads/vendors/logo.png',
    });
    prisma.vendorProfile.update.mockResolvedValue({ setupCompleted: true });

    await expect(
      service.submitProfile('vendor-id', {
        sellerType: 'RETAILER',
        termsAccepted: true,
      }),
    ).resolves.toEqual({ setupCompleted: true });
  });

  it('still requires a CAC document for a business account', async () => {
    prisma.user.findUnique.mockResolvedValue({
      registrationType: 'BUSINESS',
      role: 'BUSINESS',
    });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      bankAccountName: 'Whazz Business',
      bankAccountNumber: '0123456789',
      bankCode: '011',
      bankName: 'First Bank of Nigeria',
      bannerUrl: '/uploads/vendors/banner.png',
      cacUrl: null,
      logoUrl: '/uploads/vendors/logo.png',
    });

    await expect(
      service.submitProfile('business-id', {
        sellerType: 'BOTH',
        termsAccepted: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the vendor storefront with active products', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      _count: { trustReviews: 0 },
      id: 'profile-id',
      products: [{ id: 'product-id', likeCount: 0, status: 'ACTIVE' }],
      storeName: 'Example Store',
      trustReviews: [],
      user: { avatarUrl: '/uploads/users/avatar.png' },
      userId: 'vendor-id',
    });

    await expect(service.findStorefront('vendor-id')).resolves.toEqual({
      categories: [],
      products: [
        { id: 'product-id', likeCount: 0, salesCount: 0, status: 'ACTIVE' },
      ],
      profile: {
        avatarUrl: '/uploads/users/avatar.png',
        id: 'profile-id',
        storeName: 'Example Store',
        trustReviewCount: 0,
        trusteeCount: 0,
        trustReviews: [],
        userId: 'vendor-id',
      },
    });
  });

  it('rejects product creation until vendor setup is complete', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      id: 'profile-id',
      setupCompleted: false,
    });

    await expect(
      service.createProduct(
        'vendor-id',
        {
          category: 'Fashion & Apparel',
          subCategories: [],
          specifications: {},
          name: 'Jorani air sneakers',
          quantity: 3,
          unitPrice: 134000,
          variants: [],
        },
        ['/uploads/products/shoe.png'],
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates an active product for a completed vendor', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      id: 'profile-id',
      setupCompleted: true,
    });
    prisma.product.create.mockResolvedValue({ id: 'product-id' });
    prisma.vendorCategory.upsert.mockResolvedValue({ id: 'category-id' });

    await service.createProduct(
      'vendor-id',
      {
        category: 'Fashion & Apparel',
        mainCategory: 'Men Fashion',
        subCategories: [],
        specifications: {},
        name: 'Jorani air sneakers',
        quantity: 3,
        unitPrice: 134000,
        variants: [{ quantity: 2, type: 'Black / 42', imageIndexes: [] }],
      },
      ['/uploads/products/shoe.png'],
    );

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        category: 'Fashion & Apparel',
        description: undefined,
        imageUrls: ['/uploads/products/shoe.png'],
        mainCategory: 'Men Fashion',
        subCategories: [],
        specifications: {},
        name: 'Jorani air sneakers',
        quantity: 3,

        unitPrice: 134000,
        variants: [
          {
            color: undefined,
            imageIndexes: [],
            quantity: 2,
            size: undefined,
            type: 'Black / 42',
          },
        ],
        vendorProfileId: 'profile-id',
      },
    });

  });

  it('creates a time-limited offer for a vendor-owned product', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-09T12:00:00.000Z'));
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.product.findFirst.mockResolvedValue({
      id: 'product-id',
      unitPrice: 134000,
    });
    prisma.product.update.mockResolvedValue({ id: 'product-id' });

    await service.createProductOffer('vendor-id', 'product-id', {
      durationHours: 24,
      promoPrice: 110000,
    });

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'product-id' },
      data: {
        promoEndsAt: new Date('2026-09-10T12:00:00.000Z'),
        promoPrice: 110000,
        promoStartsAt: new Date('2026-09-09T12:00:00.000Z'),
      },
    });
    jest.useRealTimers();
  });

  it('rejects an offer price that is not below the actual price', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.product.findFirst.mockResolvedValue({
      id: 'product-id',
      unitPrice: 134000,
    });

    await expect(
      service.createProductOffer('vendor-id', 'product-id', {
        durationHours: 72,
        promoPrice: 134000,
      }),
    ).rejects.toThrow('Offer price must be lower than the actual price.');
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});
