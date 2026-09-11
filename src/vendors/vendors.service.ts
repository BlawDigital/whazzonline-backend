import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

import { CreateVendorProductDto } from './dto/create-vendor-product.dto';
import { CreateVendorCategoryDto } from './dto/create-vendor-category.dto';
import { CreateProductOfferDto } from './dto/create-product-offer.dto';
import {
  CreateDeliveryOfferType,
  CreateOfferDiscountType,
  CreateOfferDto,
  CreateOfferType,
} from './dto/create-offer.dto';
import { SaveVendorBankDto } from './dto/save-vendor-bank.dto';
import { SaveVendorProfileDto } from './dto/save-vendor-profile.dto';
import { SubmitVendorProfileDto } from './dto/submit-vendor-profile.dto';
import { UpdateStorefrontContentDto } from './dto/update-storefront-content.dto';
import { UpdateVendorProductDto } from './dto/update-vendor-product.dto';
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
        categories: { orderBy: { createdAt: 'asc' } },
        products: {
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { likes: true } } },
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

    const {
      _count,
      categories = [],
      products,
      trustReviews,
      user,
      ...store
    } = profile;
    return {
      categories: categories.map((category) => {
        const categoryProducts = products.filter(
          (product) =>
            product.status !== 'DELETED' &&
            (product.mainCategory === category.name ||
              product.category === category.name),
        );
        return {
          ...category,
          productCount: categoryProducts.length,
          outOfStock:
            categoryProducts.length > 0 &&
            categoryProducts.every((product) => product.quantity < 1),
        };
      }),
      products: products.map(({ _count: productCount, ...product }) => ({
        ...product,
        likeCount: productCount?.likes ?? 0,
      })),
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

    if (dto.mainCategory) {
      await this.prisma.vendorCategory.upsert({
        where: {
          vendorProfileId_name: {
            name: dto.mainCategory,
            vendorProfileId: profile.id,
          },
        },
        create: { name: dto.mainCategory, vendorProfileId: profile.id },
        update: {},
      });
    }

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

  async findOffers(userId: string) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');

    const offers = await this.prisma.offer.findMany({
      where: { vendorProfileId: profile.id },
      include: {
        products: {
          include: { product: true },
          orderBy: { product: { createdAt: 'desc' } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return offers.map((offer) => ({
      ...offer,
      status:
        offer.status === 'DRAFT'
          ? 'DRAFT'
          : offer.startsAt > now
            ? 'SCHEDULED'
            : offer.endsAt <= now
              ? 'ENDED'
              : 'ACTIVE',
      products: offer.products.map(({ product }) => product),
    }));
  }

  async createOffer(userId: string, dto: CreateOfferDto) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');

    const productIds = [...new Set(dto.productIds)];
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        status: 'ACTIVE',
        vendorProfileId: profile.id,
      },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException(
        'Every selected product must be an active product in your store.',
      );
    }
    if (products.some((product) => product.quantity < 1)) {
      throw new BadRequestException(
        'Out-of-stock products cannot be added to an offer.',
      );
    }

    const isDiscount =
      dto.type === CreateOfferType.PRICE_DISCOUNT ||
      dto.type === CreateOfferType.FLASH_SALE;
    if (isDiscount && (!dto.discountType || !dto.discountValue)) {
      throw new BadRequestException(
        'Choose a discount type and enter its value.',
      );
    }
    if (
      dto.discountType === CreateOfferDiscountType.PERCENTAGE &&
      (dto.discountValue ?? 0) >= 100
    ) {
      throw new BadRequestException('Percentage discount must be below 100%.');
    }

    const discountedPrice = (unitPrice: number) => {
      if (!isDiscount || !dto.discountType || !dto.discountValue) return null;
      if (dto.discountType === CreateOfferDiscountType.PERCENTAGE) {
        return Math.max(
          1,
          unitPrice - Math.floor((unitPrice * dto.discountValue) / 100),
        );
      }
      if (dto.discountType === CreateOfferDiscountType.FIXED_AMOUNT) {
        return unitPrice - dto.discountValue;
      }
      return dto.discountValue;
    };
    const promoPrices = products.map((product) => ({
      id: product.id,
      price: discountedPrice(product.unitPrice),
    }));
    if (promoPrices.some(({ price }) => price !== null && price <= 0)) {
      throw new BadRequestException(
        'The discount must leave every product with a positive price.',
      );
    }
    if (
      promoPrices.some(({ price }, index) =>
        price === null ? false : price >= products[index].unitPrice,
      )
    ) {
      throw new BadRequestException(
        'The offer price must be lower than the normal price.',
      );
    }

    const individualTotal = products.reduce(
      (total, product) => total + product.unitPrice,
      0,
    );
    if (
      dto.type === CreateOfferType.BUNDLE_DEAL &&
      (!dto.name || !dto.bundlePrice || dto.bundlePrice >= individualTotal)
    ) {
      throw new BadRequestException(
        'Enter a bundle name and a bundle price below the individual total.',
      );
    }
    if (!isDiscount && dto.type === CreateOfferType.DELIVERY) {
      if (!dto.deliveryType) {
        throw new BadRequestException('Choose a delivery offer type.');
      }
      if (
        dto.deliveryType === CreateDeliveryOfferType.REDUCED &&
        (!dto.deliveryFee || dto.deliveryFee < 1)
      ) {
        throw new BadRequestException('Enter the reduced delivery fee.');
      }
    }

    const startsAt = new Date();
    const endsAt = new Date(
      startsAt.getTime() + dto.durationHours * 60 * 60 * 1000,
    );
    return this.prisma.$transaction(async (transaction) => {
      const offer = await transaction.offer.create({
        data: {
          applicableLocations: dto.applicableLocations ?? [],
          bundlePrice: dto.bundlePrice,
          deliveryFee:
            dto.deliveryType === CreateDeliveryOfferType.FREE
              ? 0
              : dto.deliveryFee,
          deliveryType: dto.deliveryType,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          endsAt,
          minimumOrderValue: dto.minimumOrderValue,
          name: dto.name,
          products: {
            create: productIds.map((productId) => ({ productId })),
          },
          startsAt,
          type: dto.type,
          vendorProfileId: profile.id,
        },
        include: { products: { include: { product: true } } },
      });
      await Promise.all(
        promoPrices.map(({ id, price }) =>
          price === null
            ? Promise.resolve()
            : transaction.product.update({
                where: { id },
                data: {
                  promoEndsAt: endsAt,
                  promoPrice: price,
                  promoStartsAt: startsAt,
                },
              }),
        ),
      );
      return {
        ...offer,
        products: offer.products.map(({ product }) => product),
      };
    });
  }

  private async requireOwnedProduct(userId: string, productId: string) {
    await this.requireVendorUser(userId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, vendorProfile: { userId } },
    });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }

  async updateProduct(
    userId: string,
    productId: string,
    dto: UpdateVendorProductDto,
  ) {
    await this.requireOwnedProduct(userId, productId);
    return this.prisma.product.update({ where: { id: productId }, data: dto });
  }

  async archiveProduct(userId: string, productId: string) {
    await this.requireOwnedProduct(userId, productId);
    return this.prisma.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED' },
    });
  }

  async deleteProduct(userId: string, productId: string) {
    await this.requireOwnedProduct(userId, productId);
    await this.prisma.product.update({
      where: { id: productId },
      data: { status: 'DELETED' },
    });
    return { id: productId };
  }

  async createCategory(userId: string, dto: CreateVendorCategoryDto) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');
    const existing = await this.prisma.vendorCategory.findUnique({
      where: {
        vendorProfileId_name: { name: dto.name, vendorProfileId: profile.id },
      },
    });
    if (existing)
      throw new BadRequestException('This category is already in your store.');
    return this.prisma.vendorCategory.create({
      data: { name: dto.name, vendorProfileId: profile.id },
    });
  }

  async deleteCategory(userId: string, categoryId: string) {
    await this.requireVendorUser(userId);
    const result = await this.prisma.vendorCategory.deleteMany({
      where: { id: categoryId, vendorProfile: { userId } },
    });
    if (!result.count) throw new NotFoundException('Category not found.');
    return { id: categoryId };
  }

  async updateStorefront(userId: string, dto: UpdateStorefrontContentDto) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');
    return this.prisma.vendorProfile.update({ where: { userId }, data: dto });
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
