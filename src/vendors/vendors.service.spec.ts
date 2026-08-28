import { ForbiddenException, NotFoundException } from '@nestjs/common';

jest.mock('prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { VendorsService } from './vendors.service';

describe('VendorsService', () => {
  const prisma = {
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
        setupCompleted: false,
        state: 'Lagos',
        storeName: 'Example Store',
        subCategory: 'Clothing',
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

  it('marks setup complete only when both identity images exist', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'VENDOR' });
    prisma.vendorProfile.findUnique.mockResolvedValue({
      bannerUrl: '/uploads/vendors/banner.png',
      logoUrl: null,
    });
    prisma.vendorProfile.update.mockResolvedValue({ setupCompleted: true });

    await service.saveIdentity('vendor-id', {
      logoUrl: '/uploads/vendors/logo.png',
    });

    expect(prisma.vendorProfile.update).toHaveBeenCalledWith({
      data: {
        logoUrl: '/uploads/vendors/logo.png',
        setupCompleted: true,
      },
      where: { userId: 'vendor-id' },
    });
  });
});
