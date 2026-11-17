import { normalizeSpecifications } from '../common/product-options';
import { Prisma } from 'generated/prisma/client';
import { addMonths } from '../referrals/merchant-billing.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

import { CreateVendorProductDto } from './dto/create-vendor-product.dto';
import { storeCategories } from './store-categories';
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
        where: {
          vendorId: userId,
          order: { paymentStatus: 'paid', invoices: { none: {} } },
        },
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
    const directInvoices = await this.prisma.goodsInvoice.findMany({
      where: { vendorId: userId, status: 'PAID' },
      select: { id: true, subtotal: true, paidAt: true, orderId: true },
    });
    const sales = [
      ...orderItems.map((item) => ({
        amount: item.unitPrice * item.quantity,
        createdAt: item.createdAt,
        id: item.id,
        orderId: item.orderId,
      })),
      ...directInvoices.map((invoice) => ({
        amount: invoice.subtotal,
        createdAt: invoice.paidAt!,
        id: invoice.id,
        orderId: invoice.orderId,
      })),
    ];
    const grossSales = sales.reduce((sum, sale) => sum + sale.amount, 0);
    const platformFees = 0;
    const netEarnings = grossSales - platformFees;
    const completedPayouts = wallet.transactions
      .filter((item) => item.status === 'COMPLETED')
      .reduce((sum, item) => sum + Math.abs(item.amount), 0);
    const pendingPayouts = wallet.transactions
      .filter((item) => item.status === 'PENDING')
      .reduce((sum, item) => sum + Math.abs(item.amount), 0);
    const availableBalance = 0;
    const fees: typeof saleTransactions = [];
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
      paymentModel: 'direct_to_merchant',
      platformFeePercent: 0,
      platformFees,
      payouts,
      recentEarnings: saleTransactions.slice(0, 5),
      storeName: profile.storeName,
      totalSales: grossSales,
      transactions,
    };
  }

  async requestWithdrawal(userId: string, _amount: number) {
    void _amount;
    await this.requireVendorUser(userId);
    throw new BadRequestException(
      'Goods payments settle directly to your merchant account. There is no Whazzonline goods balance to withdraw.',
    );
  }
  async findProfile(userId: string) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');
    return profile;
  }

  async findStorefront(userId: string, manage = false) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      include: {
        _count: { select: { trustReviews: true } },

        products: {
          ...(manage ? {} : { where: { status: 'ACTIVE' as const } }),
          orderBy: { createdAt: 'desc' },
          include: {
            aisle: { select: { name: true } },
            _count: { select: { likes: true } },
          },
        },
        user: {
          select: { avatarUrl: true, registrationType: true, role: true },
        },
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
    const [sales, trustees] = await Promise.all([
      products.length
        ? this.prisma.commerceOrderItem.groupBy({
            by: ['productId'],
            where: {
              productId: { in: products.map((product) => product.id) },
              order: { status: 'delivered' },
            },
            _sum: { quantity: true },
          })
        : Promise.resolve([]),
      this.prisma.vendorTrustReview.groupBy({
        by: ['reviewerUserId'],
        where: { vendorProfileId: profile.id },
      }),
    ]);
    const sold = new Map<string, number>(
      sales.map(
        (sale: { productId: string; _sum: { quantity: number | null } }) =>
          [sale.productId, sale._sum.quantity ?? 0] as const,
      ),
    );
    return {
      categories: storeCategories(products, profile.id),
      products: products.map(({ _count: productCount, ...product }) => ({
        ...product,
        likeCount: productCount?.likes ?? 0,
        salesCount: sold.get(product.id) ?? 0,
      })),
      profile: {
        ...store,
        bankAccountName: undefined,
        bankAccountNumber: undefined,
        bankCode: undefined,
        bankName: undefined,
        cacUrl: undefined,
        avatarUrl: user.avatarUrl,
        isBusiness:
          user.registrationType === 'BUSINESS' || user.role === 'BUSINESS',
        trustReviewCount: _count.trustReviews,
        trusteeCount: trustees.length,
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
    videoUrl?: string,
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
      const options = normalizeSpecifications(variant.options ?? {});
      if (!color && !size && !type && !Object.keys(options).length) {
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
      return {
        color,
        imageIndexes,
        quantity: variant.quantity,
        size,
        type,
        ...(variant.colorHex ? { colorHex: variant.colorHex } : {}),
        ...(Object.keys(options).length ? { options } : {}),
      };
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

    return this.prisma.product.create({
      data: {
        category: dto.category,
        description: dto.description,
        imageUrls,
        ...(videoUrl ? { videoUrl } : {}),
        mainCategory: dto.mainCategory,
        name: dto.name,
        quantity: dto.quantity,
        specifications: normalizeSpecifications(dto.specifications),
        subCategories: dto.subCategories,
        unitPrice: dto.unitPrice,
        variants: normalizedVariants,
        vendorProfileId: profile.id,
      },
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

  async createOffer(userId: string, dto: CreateOfferDto, draftId?: string) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { id: true, city: true, state: true },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');

    const draft = dto.intent === 'DRAFT';
    if (draftId) {
      const existing = await this.prisma.offer.findFirst({
        where: { id: draftId, vendorProfileId: profile.id },
        include: { products: { include: { product: true } } },
      });
      if (!existing) throw new NotFoundException('Draft offer not found.');
      if (existing.status !== 'DRAFT') {
        if (
          dto.requestId &&
          existing.createRequestId === `${userId}:${dto.requestId}`
        )
          return {
            ...existing,
            products: existing.products.map(({ product }) => product),
          };
        throw new BadRequestException('This offer has already been published.');
      }
    } else if (dto.requestId) {
      const existing = await this.prisma.offer.findUnique({
        where: { createRequestId: `${userId}:${dto.requestId}` },
        include: { products: { include: { product: true } } },
      });
      if (existing)
        return {
          ...existing,
          products: existing.products.map(({ product }) => product),
        };
    }

    const productIds = [...new Set(dto.productIds)];
    if (!draft && !productIds.length)
      throw new BadRequestException('Select at least one product.');
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
    if (!draft && products.some((product) => product.quantity < 1)) {
      throw new BadRequestException(
        'Out-of-stock products cannot be added to an offer.',
      );
    }

    const isDiscount =
      dto.type === CreateOfferType.PRICE_DISCOUNT ||
      dto.type === CreateOfferType.FLASH_SALE;
    if (!draft && isDiscount && (!dto.discountType || !dto.discountValue)) {
      throw new BadRequestException(
        'Choose a discount type and enter its value.',
      );
    }
    if (
      !draft &&
      dto.discountType === CreateOfferDiscountType.PERCENTAGE &&
      (dto.discountValue ?? 0) >= 100
    ) {
      throw new BadRequestException('Percentage discount must be below 100%.');
    }

    const discountedPrice = (unitPrice: number) => {
      if (draft || !isDiscount || !dto.discountType || !dto.discountValue)
        return null;
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
      !draft &&
      dto.type === CreateOfferType.BUNDLE_DEAL &&
      (productIds.length < 2 ||
        !dto.name ||
        !dto.bundlePrice ||
        dto.bundlePrice >= individualTotal)
    ) {
      throw new BadRequestException(
        'Enter a bundle name and a bundle price below the individual total.',
      );
    }
    if (!draft && dto.type === CreateOfferType.DELIVERY) {
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

    const now = new Date();
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : now;
    if (!draft && dto.startsAt && startsAt <= now)
      throw new BadRequestException('Choose a future start date and time.');
    const endsAt = new Date(
      startsAt.getTime() + dto.durationHours * 60 * 60 * 1000,
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            if (!draft) {
              const conflict = await transaction.offer.findFirst({
                where: {
                  ...(draftId ? { id: { not: draftId } } : {}),
                  vendorProfileId: profile.id,
                  status: { in: ['ACTIVE', 'SCHEDULED'] },
                  startsAt: { lt: endsAt },
                  endsAt: { gt: startsAt },
                  products: { some: { productId: { in: productIds } } },
                },
              });
              if (conflict)
                throw new BadRequestException(
                  'A selected product already belongs to an offer during this time. Choose a different time or product.',
                );
            }
            const data = {
              applicableLocations:
                dto.type === CreateOfferType.DELIVERY
                  ? (dto.applicableLocations ?? [])
                  : [],
              bundlePrice:
                dto.type === CreateOfferType.BUNDLE_DEAL
                  ? (dto.bundlePrice ?? null)
                  : null,
              deliveryFee:
                dto.deliveryType === CreateDeliveryOfferType.FREE
                  ? 0
                  : (dto.deliveryFee ?? null),
              deliveryType:
                dto.type === CreateOfferType.DELIVERY
                  ? (dto.deliveryType ?? null)
                  : null,
              discountType: isDiscount ? (dto.discountType ?? null) : null,
              discountValue: isDiscount ? (dto.discountValue ?? null) : null,
              endsAt,
              minimumOrderValue: dto.minimumOrderValue ?? null,
              name: dto.name || products[0]?.name || null,
              description: dto.description?.trim() || null,
              mediaUrls: dto.mediaUrls ?? [],
              stockLimit: isDiscount ? (dto.stockLimit ?? null) : null,
              status: draft
                ? ('DRAFT' as const)
                : startsAt > now
                  ? ('SCHEDULED' as const)
                  : ('ACTIVE' as const),
              startsAt,
              type: dto.type,
              vendorProfileId: profile.id,
            };
            const offer = await (draftId
              ? transaction.offer.update({
                  where: { id: draftId, status: 'DRAFT' },
                  data: {
                    ...data,
                    createRequestId: dto.requestId
                      ? `${userId}:${dto.requestId}`
                      : undefined,
                    products: {
                      deleteMany: {},
                      create: productIds.map((productId) => ({ productId })),
                    },
                  },
                  include: { products: { include: { product: true } } },
                })
              : transaction.offer.create({
                  data: {
                    ...data,
                    createRequestId: dto.requestId
                      ? `${userId}:${dto.requestId}`
                      : null,
                    products: {
                      create: productIds.map((productId) => ({ productId })),
                    },
                  },
                  include: { products: { include: { product: true } } },
                }));
            return {
              ...offer,
              products: offer.products.map(({ product }) => product),
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 2
        )
          continue;
        if (
          dto.requestId &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2025'].includes(error.code)
        ) {
          const existing = await this.prisma.offer.findUnique({
            where: { createRequestId: `${userId}:${dto.requestId}` },
            include: { products: { include: { product: true } } },
          });
          if (existing)
            return {
              ...existing,
              products: existing.products.map(({ product }) => product),
            };
        }
        throw error;
      }
    }
    throw new BadRequestException('The offer changed. Please try again.');
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
    const product = await this.requireOwnedProduct(userId, productId);
    if (product.status === 'DELETED')
      throw new BadRequestException('Deleted products cannot be edited.');
    const variants = dto.variants?.map((v) => {
      const options = normalizeSpecifications(v.options ?? {});
      if (
        !v.type?.trim() &&
        !v.color?.trim() &&
        !v.size?.trim() &&
        !Object.keys(options).length
      )
        throw new BadRequestException(
          'Each variant needs a name, color, or size.',
        );
      if (v.imageIndexes.some((index) => index >= product.imageUrls.length))
        throw new BadRequestException('Variant image is unavailable.');
      return {
        type: normalizeOptionalVariant(v.type),
        color: normalizeOptionalVariant(v.color),
        size: normalizeOptionalVariant(v.size),
        ...(v.colorHex ? { colorHex: v.colorHex } : {}),
        ...(Object.keys(options).length ? { options } : {}),
        quantity: v.quantity,
        imageIndexes: v.imageIndexes,
      };
    });
    const stockVariants =
      variants ?? (Array.isArray(product.variants) ? product.variants : []);
    let allocated = 0;
    for (const v of stockVariants)
      if (
        v &&
        typeof v === 'object' &&
        'quantity' in v &&
        typeof v.quantity === 'number'
      )
        allocated += v.quantity;
    if (allocated > (dto.quantity ?? product.quantity))
      throw new BadRequestException(
        'Variant quantities cannot exceed total stock.',
      );
    const fields = {
      name: dto.name,
      description: dto.description,
      unitPrice: dto.unitPrice,
      quantity: dto.quantity,
    };
    return this.prisma.product.update({
      where: { id: productId },
      data: { ...fields, ...(variants ? { variants } : {}) },
    });
  }

  async archiveProduct(userId: string, productId: string) {
    await this.requireOwnedProduct(userId, productId);
    return this.prisma.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED' },
    });
  }

  async activateProduct(userId: string, productId: string) {
    const product = await this.requireOwnedProduct(userId, productId);
    if (product.status !== 'ARCHIVED')
      throw new BadRequestException('Only archived products can be restored.');
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!profile?.setupCompleted)
      throw new BadRequestException(
        'Complete store setup before restoring a product.',
      );
    return this.prisma.product.update({
      where: { id: productId },
      data: { status: 'ACTIVE' },
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

  async updateStorefront(userId: string, dto: UpdateStorefrontContentDto) {
    await this.requireVendorUser(userId);
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found.');
    if (
      dto.representativeName !== undefined &&
      dto.representativeName.trim().length < 2
    )
      throw new BadRequestException(
        'A named CEO or authorized representative is required.',
      );
    if (dto.featuredProductId) {
      const product = await this.prisma.product.findFirst({
        where: {
          id: dto.featuredProductId,
          vendorProfileId: profile.id,
          status: 'ACTIVE',
        },
      });
      if (!product)
        throw new BadRequestException(
          'Choose an active product from your own store.',
        );
    }
    return this.prisma.vendorProfile.update({
      where: { userId },
      data: {
        ...dto,
        storefrontDetails: dto.storefrontDetails
          ? {
              ...dto.storefrontDetails,
              businessHours:
                dto.storefrontDetails.businessHours?.map((row) => ({
                  label: row.label.trim(),
                  value: row.value.trim(),
                })) ?? [],
            }
          : undefined,
        socialLinks: dto.socialLinks?.map((link) => ({
          label: link.label.trim(),
          url: link.url,
        })),
      },
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

  async saveRepresentativePhoto(
    userId: string,
    representativePhotoUrl: string,
  ) {
    await this.requireVendorUser(userId);
    const existing = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });
    if (!existing)
      throw new NotFoundException(
        'Save the vendor profile before uploading a representative photo.',
      );
    const updated = await this.prisma.vendorProfile.update({
      where: { userId },
      data: { representativePhotoUrl },
    });
    if (existing.representativePhotoUrl !== representativePhotoUrl) {
      await removeVendorUploadUrl(existing.representativePhotoUrl);
    }
    return updated;
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
        ...(uploads.cacUrl || !existing.setupCompleted
          ? {
              reviewStatus: 'DRAFT',
              setupCompleted: false,
              submittedAt: null,
              termsAcceptedAt: null,
            }
          : {}),
      },
    });

    if (uploads.logoUrl && existing.logoUrl !== uploads.logoUrl) {
      await removeVendorUploadUrl(existing.logoUrl);
    }
    if (uploads.bannerUrl && existing.bannerUrl !== uploads.bannerUrl) {
      await removeVendorUploadUrl(existing.bannerUrl);
    }
    if (uploads.cacUrl && existing.cacUrl !== uploads.cacUrl) {
      await removeVendorUploadUrl(existing.cacUrl);
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

    const submittedAt = existing.submittedAt ?? new Date();
    const representativeName = dto.representativeName?.trim() || '';
    if (representativeName.length < 2)
      throw new BadRequestException(
        'Add a named CEO or authorized representative in About before submitting.',
      );
    return this.prisma.vendorProfile.update({
      where: { userId },
      data: {
        reviewStatus: 'PENDING',
        representativeName,
        representativeRole: dto.representativeRole,
        sellerType: dto.sellerType,
        setupCompleted: true,
        submittedAt,
        termsAcceptedAt: submittedAt,
        user: {
          update: {
            merchantSubscription: {
              upsert: {
                create: {
                  trialStartedAt: submittedAt,
                  trialEndsAt: addMonths(submittedAt, 1),
                },
                update: {},
              },
            },
          },
        },
      },
    });
  }
}
