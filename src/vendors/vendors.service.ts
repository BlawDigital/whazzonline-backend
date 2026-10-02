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
import { vendorFinanceConfig } from './vendor-finance.config';

const SIZE_VARIANTS = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl']);

function normalizeVariantType(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return SIZE_VARIANTS.has(normalized.toLowerCase())
    ? normalized.toUpperCase()
    : normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeOptionalVariant(value?: string) {
  return value?.trim() ? normalizeVariantType(value) : undefined;
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

  private async financeData(userId: string) {
    const user = await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: {
        bankAccountName: true,
        bankAccountNumber: true,
        bankCode: true,
        bankName: true,
        storeName: true,
      },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');

    const [orderItems, wallet] = await Promise.all([
      this.prisma.commerceOrderItem.findMany({
        where: { vendorId: userId, order: { status: 'delivered' } },
        select: {
          createdAt: true,
          id: true,
          orderId: true,
          quantity: true,
          unitPrice: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.wallet.upsert({
        where: { userId },
        create: {
          accountName:
            [user.firstName, user.lastName].filter(Boolean).join(' ') ||
            profile.storeName,
          accountNumber: `019${userId.replace(/-/g, '').slice(0, 7)}`,
          bankName: 'Paystack - Titan',
          userId,
        },
        update: {},
        include: {
          transactions: {
            where: { type: 'WITHDRAWAL' },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
    ]);

    return { orderItems, profile, wallet };
  }

  async finance(userId: string) {
    const { orderItems, profile, wallet } = await this.financeData(userId);
    const sales = orderItems.map((item) => ({
      amount: item.unitPrice * item.quantity,
      createdAt: item.createdAt,
      id: item.id,
      orderId: item.orderId,
    }));
    const grossSales = sales.reduce((sum, sale) => sum + sale.amount, 0);
    const platformFees = Math.round(
      grossSales * (vendorFinanceConfig.platformFeePercent / 100),
    );
    const netEarnings = grossSales - platformFees;
    const completedPayouts = wallet.transactions
      .filter((item) => item.status === 'COMPLETED')
      .reduce((sum, item) => sum + Math.abs(item.amount), 0);
    const pendingPayouts = wallet.transactions
      .filter((item) => item.status === 'PENDING')
      .reduce((sum, item) => sum + Math.abs(item.amount), 0);
    const availableBalance = Math.max(
      netEarnings - completedPayouts - pendingPayouts,
      0,
    );
    const fees = sales.map((sale) => ({
      amount: -Math.round(
        sale.amount * (vendorFinanceConfig.platformFeePercent / 100),
      ),
      createdAt: sale.createdAt.toISOString(),
      description: 'Platform Service Fee',
      id: `fee-${sale.id}`,
      orderId: sale.orderId,
      type: 'FEE' as const,
    }));
    const saleTransactions = sales.map((sale) => ({
      amount: sale.amount,
      createdAt: sale.createdAt.toISOString(),
      description: `Order #${sale.orderId.slice(-6).toUpperCase()}`,
      id: `sale-${sale.id}`,
      orderId: sale.orderId,
      type: 'SALE' as const,
    }));
    const payouts = wallet.transactions.map((item) => ({
      amount: Math.abs(item.amount),
      createdAt: item.createdAt.toISOString(),
      description: 'Withdrawal to Bank',
      id: item.id,
      status: item.status,
    }));
    const payoutTransactions = payouts.map((item) => ({
      ...item,
      amount: -item.amount,
      type: 'PAYOUT' as const,
    }));
    const transactions = [
      ...saleTransactions,
      ...fees,
      ...payoutTransactions,
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const now = new Date();
    const monthlyGrowth = Array.from({ length: 9 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 8 + index, 1);
      const amount = sales
        .filter(
          (sale) =>
            sale.createdAt.getFullYear() === date.getFullYear() &&
            sale.createdAt.getMonth() === date.getMonth(),
        )
        .reduce((sum, sale) => sum + sale.amount, 0);
      return {
        amount,
        label: date.toLocaleString('en', { month: 'short' }),
      };
    });

    return {
      availableBalance,
      bankAccount: {
        accountName: profile.bankAccountName,
        accountNumber: profile.bankAccountNumber,
        bankCode: profile.bankCode,
        bankName: profile.bankName,
      },
      completedPayouts,
      grossSales,
      monthlyGrowth,
      minimumWithdrawalAmount: vendorFinanceConfig.minimumWithdrawalAmount,
      netEarnings,
      pendingPayouts,
      platformFeePercent: vendorFinanceConfig.platformFeePercent,
      platformFees,
      payouts,
      recentEarnings: saleTransactions.slice(0, 5),
      storeName: profile.storeName,
      totalSales: grossSales,
      transactions,
    };
  }

  async requestWithdrawal(userId: string, amount: number) {
    const data = await this.finance(userId);
    if (!data.bankAccount.accountNumber || !data.bankAccount.bankName) {
      throw new BadRequestException(
        'Add and verify a bank account before withdrawing funds.',
      );
    }
    if (amount > data.availableBalance) {
      throw new BadRequestException('Withdrawal exceeds available balance.');
    }
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Vendor wallet not found.');
    return this.prisma.walletTransaction.create({
      data: {
        amount: -amount,
        description: 'Withdrawal to Bank',
        status: 'PENDING',
        type: 'WITHDRAWAL',
        walletId: wallet.id,
      },
    });
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
    const normalizedVariants = dto.variants.map((variant) => {
      const color = normalizeOptionalVariant(variant.color);
      const size = normalizeOptionalVariant(variant.size);
      const type = normalizeOptionalVariant(variant.type);
      if (!color && !size && !type) {
        throw new BadRequestException(
          'Each product variant needs a color, size, or variant name.',
        );
      }
      const imageIndexes = [...new Set(variant.imageIndexes ?? [])];
      if (imageIndexes.some((index) => index >= imageUrls.length)) {
        throw new BadRequestException(
          'A variant points to a product image that was not uploaded.',
        );
      }
      return { color, imageIndexes, quantity: variant.quantity, size, type };
    });
    const variantQuantity = normalizedVariants.reduce(
      (total, variant) => total + variant.quantity,
      0,
    );
    if (normalizedVariants.length && variantQuantity > dto.quantity) {
      throw new BadRequestException(
        'Variant quantities cannot exceed the total product quantity.',
      );
    }

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
