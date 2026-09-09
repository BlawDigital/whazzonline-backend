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
    product: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    vendorProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const service = new VendorsService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

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
      id: 'profile-id',
      products: [{ id: 'product-id', status: 'ACTIVE' }],
      storeName: 'Example Store',
      user: { avatarUrl: '/uploads/users/avatar.png' },
      userId: 'vendor-id',
    });

    await expect(service.findStorefront('vendor-id')).resolves.toEqual({
      products: [{ id: 'product-id', status: 'ACTIVE' }],
      profile: {
        avatarUrl: '/uploads/users/avatar.png',
        id: 'profile-id',
        storeName: 'Example Store',
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

    await service.createProduct(
      'vendor-id',
      {
        category: 'Fashion & Apparel',
        name: 'Jorani air sneakers',
        promoPrice: 110000,
        quantity: 3,
        unitPrice: 134000,
        variants: [{ quantity: 2, type: 'Black / 42' }],
      },
      ['/uploads/products/shoe.png'],
    );

    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        category: 'Fashion & Apparel',
        imageUrls: ['/uploads/products/shoe.png'],
        name: 'Jorani air sneakers',
        promoPrice: 110000,
        quantity: 3,
        unitPrice: 134000,
        variants: [{ quantity: 2, type: 'Black / 42' }],
        vendorProfileId: 'profile-id',
      },
    });
  });

  it('rejects a promo price that is not below the actual price', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      id: 'profile-id',
      setupCompleted: true,
    });

    await expect(
      service.createProduct(
        'vendor-id',
        {
          category: 'Fashion & Apparel',
          name: 'Jorani air sneakers',
          promoPrice: 134000,
          quantity: 3,
          unitPrice: 134000,
          variants: [],
        },
        ['/uploads/products/shoe.png'],
      ),
    ).rejects.toThrow('Promo price must be lower than the actual price.');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });
});
