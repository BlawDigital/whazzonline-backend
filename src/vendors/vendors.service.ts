import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

import { CreateVendorProductDto } from './dto/create-vendor-product.dto';
import { CreateProductOfferDto } from './dto/create-product-offer.dto';
import { SaveVendorBankDto } from './dto/save-vendor-bank.dto';
import { SaveVendorProfileDto } from './dto/save-vendor-profile.dto';
import { SubmitVendorProfileDto } from './dto/submit-vendor-profile.dto';
import { removeVendorUploadUrl } from './vendor-upload.config';

const SIZE_VARIANTS = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl']);

function normalizeVariantType(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return SIZE_VARIANTS.has(normalized.toLowerCase())
    ? normalized.toUpperCase()
    : normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireVendorUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    if (user.role !== 'VENDOR' && user.role !== 'BUSINESS') {
      throw new ForbiddenException(
        'This account cannot create a vendor profile.',
      );
    }
    return user;
  }

  async findProfile(userId: string) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');
    return profile;
  }

  async findStorefront(userId: string) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      include: {
        _count: { select: { trustReviews: true } },
        products: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
        },
        user: { select: { avatarUrl: true } },
        trustReviews: {
          orderBy: { createdAt: 'desc' },
          select: {
            createdAt: true,
            id: true,
            reason: true,
            reviewer: {
              select: {
                avatarUrl: true,
                city: true,
                firstName: true,
                lastName: true,
                state: true,
              },
            },
          },
          take: 50,
        },
      },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');

    const { _count, products, trustReviews, user, ...store } = profile;
    return {
      products,
      profile: {
        ...store,
        avatarUrl: user.avatarUrl,
        trustReviewCount: _count.trustReviews,
        trustReviews: trustReviews.map((review) => ({
          avatarUrl: review.reviewer.avatarUrl,
          createdAt: review.createdAt.toISOString(),
          id: review.id,
          location: [review.reviewer.city, review.reviewer.state]
            .filter(Boolean)
            .join(', '),
          reviewerName: review.reviewer.firstName
            ? `${review.reviewer.firstName}${review.reviewer.lastName ? ` ${review.reviewer.lastName.slice(0, 1)}.` : ''}`
            : 'Verified buyer',
          reason: review.reason,
        })),
      },
    };
  }

  async findProducts(userId: string) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');

    return this.prisma.product.findMany({
      where: { vendorProfileId: profile.id, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findTrustReviews(userId: string) {
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        trustReviews: {
          orderBy: { createdAt: 'desc' },
          select: {
            createdAt: true,
            id: true,
            reason: true,
            reviewer: {
              select: {
                avatarUrl: true,
                city: true,
                firstName: true,
                lastName: true,
                state: true,
              },
            },
          },
          take: 50,
        },
        _count: { select: { trustReviews: true } },
      },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');

    return {
      count: profile._count.trustReviews,
      reviews: profile.trustReviews.map((review) => ({
        avatarUrl: review.reviewer.avatarUrl,
        createdAt: review.createdAt.toISOString(),
        id: review.id,
        location: [review.reviewer.city, review.reviewer.state]
          .filter(Boolean)
          .join(', '),
        reviewerName: review.reviewer.firstName
          ? `${review.reviewer.firstName}${review.reviewer.lastName ? ` ${review.reviewer.lastName.slice(0, 1)}.` : ''}`
          : 'Verified buyer',
        reason: review.reason,
      })),
    };
  }

  async createProduct(
    userId: string,
    dto: CreateVendorProductDto,
    imageUrls: string[],
  ) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true, setupCompleted: true },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');
    if (!profile.setupCompleted) {
      throw new BadRequestException(
        'Complete your vendor setup before adding products.',
      );
    }
    const normalizedVariants = Array.from(
      dto.variants.reduce((variants, variant) => {
        const type = normalizeVariantType(variant.type);
        variants.set(type, (variants.get(type) ?? 0) + variant.quantity);
        return variants;
      }, new Map<string, number>()),
      ([type, quantity]) => ({ quantity, type }),
    );

    return this.prisma.product.create({
      data: {
        category: dto.category,
        description: dto.description,
        imageUrls,
        mainCategory: dto.mainCategory,
        name: dto.name,
        quantity: dto.quantity,
        specifications: dto.specifications,
        subCategories: dto.subCategories,
        unitPrice: dto.unitPrice,
        variants: normalizedVariants,
        vendorProfileId: profile.id,
      },
    });
  }

  async createProductOffer(
    userId: string,
    productId: string,
    dto: CreateProductOfferDto,
  ) {
    await this.requireVendorUser(userId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, vendorProfile: { userId }, status: 'ACTIVE' },
      select: { id: true, unitPrice: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
    if (dto.promoPrice >= product.unitPrice) {
      throw new BadRequestException(
        'Offer price must be lower than the actual price.',
      );
    }

    const promoStartsAt = new Date();
    const promoEndsAt = new Date(
      promoStartsAt.getTime() + dto.durationHours * 60 * 60 * 1000,
    );
    return this.prisma.product.update({
      where: { id: product.id },
      data: { promoEndsAt, promoPrice: dto.promoPrice, promoStartsAt },
    });
  }

  async saveProfile(userId: string, dto: SaveVendorProfileDto) {
    await this.requireVendorUser(userId);
    return this.prisma.vendorProfile.upsert({
      where: { userId },
      create: { ...dto, userId },
      update: {
        ...dto,
        reviewStatus: 'DRAFT',
        setupCompleted: false,
        submittedAt: null,
        termsAcceptedAt: null,
      },
    });
  }

  async saveIdentity(
    userId: string,
    uploads: { bannerUrl?: string; cacUrl?: string; logoUrl?: string },
  ) {
    await this.requireVendorUser(userId);
    const existing = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!existing) {
      throw new NotFoundException(
        'Save the vendor profile before uploading images.',
      );
    }

    const updated = await this.prisma.vendorProfile.update({
      where: { userId },
      data: {
        ...uploads,
        reviewStatus: 'DRAFT',
        setupCompleted: false,
        submittedAt: null,
        termsAcceptedAt: null,
      },
    });

    if (uploads.logoUrl && existing.logoUrl !== uploads.logoUrl) {
      removeVendorUploadUrl(existing.logoUrl);
    }
    if (uploads.bannerUrl && existing.bannerUrl !== uploads.bannerUrl) {
      removeVendorUploadUrl(existing.bannerUrl);
    }
    if (uploads.cacUrl && existing.cacUrl !== uploads.cacUrl) {
      removeVendorUploadUrl(existing.cacUrl);
    }

    return updated;
  }

  async saveBank(userId: string, dto: SaveVendorBankDto) {
    await this.requireVendorUser(userId);
    const existing = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!existing) {
      throw new NotFoundException(
        'Save the vendor profile before adding payout details.',
      );
    }
    return this.prisma.vendorProfile.update({
      where: { userId },
      data: {
        bankAccountName: dto.accountName,
        bankAccountNumber: dto.accountNumber,
        bankCode: dto.bankCode,
        bankName: dto.bankName,
        reviewStatus: 'DRAFT',
        setupCompleted: false,
        submittedAt: null,
        termsAcceptedAt: null,
      },
    });
  }

  async submitProfile(userId: string, dto: SubmitVendorProfileDto) {
    const user = await this.requireVendorUser(userId);
    const existing = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!existing) throw new NotFoundException('Vendor profile not found.');

    const identityComplete = Boolean(
      existing.logoUrl &&
      existing.bannerUrl &&
      (user.registrationType !== 'BUSINESS' || existing.cacUrl),
    );
    const bankComplete = Boolean(
      existing.bankName &&
      existing.bankCode &&
      existing.bankAccountNumber &&
      existing.bankAccountName,
    );
    if (!identityComplete || !bankComplete) {
      throw new BadRequestException(
        'Complete store identity and payout details before submitting.',
      );
    }

    const submittedAt = new Date();
    return this.prisma.vendorProfile.update({
      where: { userId },
      data: {
        reviewStatus: 'PENDING',
        sellerType: dto.sellerType,
        setupCompleted: true,
        submittedAt,
        termsAcceptedAt: submittedAt,
      },
    });
  }
}
