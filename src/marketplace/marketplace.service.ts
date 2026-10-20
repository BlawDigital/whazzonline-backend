import { Injectable } from '@nestjs/common';

import { PrismaService } from 'prisma/prisma.service';
import { productSku } from '../common/product-sku';
import { priceOfferProduct } from '../vendors/offer-pricing';

const categories = [
  { id: 'cars', label: 'Cars' },
  { id: 'fashion', label: 'Fashion' },
  { id: 'beauty', label: 'Beauty & Personal Care' },
  { id: 'kids', label: 'Baby & Kids' },
];

type MarketplaceCategory = (typeof categories)[number]['id'];

function categoryFor(value: string): MarketplaceCategory {
  const normalized = value.toLowerCase();
  if (/(car|auto|vehicle|motor)/.test(normalized)) return 'cars';
  if (/(beauty|cosmetic|skin|hair)/.test(normalized)) return 'beauty';
  if (/(baby|kid|child|toy)/.test(normalized)) return 'kids';
  return 'fashion';
}

function dateListed(createdAt: Date) {
  const age = Date.now() - createdAt.getTime();
  if (age < 24 * 60 * 60 * 1000) return 'today';
  if (age < 7 * 24 * 60 * 60 * 1000) return 'this-week';
  return 'this-month';
}

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const [products, vendors] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: 'ACTIVE', vendorProfile: { setupCompleted: true } },
        include: {
          aisle: {
            select: { name: true },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
            },
          },
          vendorProfile: {
            select: {
              address: true,
              city: true,
              state: true,
              storeName: true,
              userId: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vendorProfile.findMany({
        where: { setupCompleted: true },
        orderBy: { createdAt: 'desc' },
        select: {
          address: true,
          featuredProductId: true,
          bannerUrl: true,
          category: true,
          reviewStatus: true,
          city: true,
          description: true,
          about: true,
          socialLinks: true,
          representativeName: true,
          representativeRole: true,
          representativeBio: true,
          representativePhotoUrl: true,
          user: { select: { registrationType: true, role: true } },
          logoUrl: true,
          state: true,
          storeName: true,
          userId: true,
          _count: { select: { trustReviews: true } },
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
            take: 10,
          },
        },
      }),
    ]);

    const sales = products.length
      ? await this.prisma.commerceOrderItem.groupBy({
          by: ['productId'],
          where: {
            productId: { in: products.map((product) => product.id) },
            order: { status: 'delivered' },
          },
          _sum: { quantity: true },
        })
      : [];
    const salesByProduct = new Map(
      sales.map((sale) => [sale.productId, sale._sum.quantity ?? 0]),
    );
    const ratings = products.length
      ? await this.prisma.productReview.groupBy({
          by: ['productId'],
          where: { productId: { in: products.map((product) => product.id) } },
          _avg: { rating: true },
          _count: { _all: true },
        })
      : [];
    const ratingByProduct = new Map(
      ratings.map((row) => [
        row.productId,
        { average: row._avg.rating ?? 0, count: row._count._all },
      ]),
    );
    const now = new Date();
    const offers = products.length
      ? await this.prisma.offer.findMany({
          where: {
            type: { in: ['PRICE_DISCOUNT', 'FLASH_SALE'] },
            status: { in: ['ACTIVE', 'SCHEDULED'] },
            startsAt: { lte: now },
            endsAt: { gt: now },
            products: {
              some: { productId: { in: products.map((p) => p.id) } },
            },
          },
          include: { products: true },
        })
      : [];
    return {
      categories,
      products: products.map((product) => {
        let promoPrice = product.promoPrice;
        let offerEndsAt = product.promoEndsAt;
        let offerActive = Boolean(
          promoPrice &&
          product.promoStartsAt &&
          product.promoEndsAt &&
          product.promoStartsAt <= now &&
          product.promoEndsAt > now,
        );
        if (!offerActive) promoPrice = null;
        for (const offer of offers) {
          if (
            !offer.products.some((p) => p.productId === product.id) ||
            (offer.minimumOrderValue ?? 0) > product.unitPrice ||
            !offer.discountType ||
            !offer.discountValue ||
            (offer.stockLimit !== null &&
              offer.unitsClaimed >= offer.stockLimit)
          )
            continue;
          const price = priceOfferProduct(
            product.unitPrice,
            offer.discountType,
            offer.discountValue,
          );
          if (price > 0 && price < (promoPrice ?? product.unitPrice)) {
            promoPrice = price;
            offerEndsAt = offer.endsAt;
            offerActive = true;
          }
        }
        return {
          category: categoryFor(product.category),
          storeCategory: product.category,
          categoryPath: [
            product.mainCategory,
            ...(product.subCategories || []),
            product.aisle?.name,
          ].filter(Boolean),
          reviewAverage: ratingByProduct.get(product.id)?.average ?? 0,
          reviewCount: ratingByProduct.get(product.id)?.count ?? 0,
          dateListed: dateListed(product.createdAt),
          id: product.id,
          likeCount: product._count.likes,
          quantity: product.quantity,
          commentCount: product._count.comments,
          salesCount: salesByProduct.get(product.id) ?? 0,
          imageUri: product.imageUrls[0] ?? '',
          imageUris: product.imageUrls,
          location: `${product.vendorProfile.city}, ${product.vendorProfile.state}`,
          mapAddress: [
            product.vendorProfile.address,
            product.vendorProfile.city,
            product.vendorProfile.state,
            'Nigeria',
          ]
            .filter(Boolean)
            .join(', '),
          name: product.name,
          price: `₦${product.unitPrice.toLocaleString()}`,
          salePrice: offerActive
            ? `₦${promoPrice?.toLocaleString()}`
            : undefined,
          offerEndsAt: offerActive ? offerEndsAt?.toISOString() : undefined,
          seller: product.vendorProfile.storeName,
          vendorId: product.vendorProfile.userId,
          sku: productSku(product.id),
          description: product.description,
          specifications: product.specifications,
          variants: product.variants,
        };
      }),
      vendors: vendors.map((vendor) => ({
        featuredProductId: products.some(
          (p) => p.id === vendor.featuredProductId,
        )
          ? vendor.featuredProductId
          : null,
        category: vendor.category,
        verified: vendor.reviewStatus === 'APPROVED',
        coverUri: vendor.bannerUrl ?? '',
        description: vendor.description,
        about: vendor.about,
        socialLinks: vendor.socialLinks,
        representativeName: vendor.representativeName,
        representativeRole: vendor.representativeRole,
        representativeBio: vendor.representativeBio,
        representativePhotoUrl: vendor.representativePhotoUrl,
        isBusiness:
          vendor.user?.registrationType === 'BUSINESS' ||
          vendor.user?.role === 'BUSINESS',
        id: vendor.userId,
        location: `${vendor.city}, ${vendor.state}`,
        mapAddress: [vendor.address, vendor.city, vendor.state, 'Nigeria']
          .filter(Boolean)
          .join(', '),
        logoUri: vendor.logoUrl,
        name: vendor.storeName,
        trustReviewCount: vendor._count.trustReviews,
        trustReviews: vendor.trustReviews.map((review) => ({
          avatarUrl: review.reviewer.avatarUrl,
          createdAt: review.createdAt.toISOString(),
          id: review.id,
          location: [review.reviewer.city, review.reviewer.state]
            .filter(Boolean)
            .join(', '),
          reason: review.reason,
          reviewerName: review.reviewer.firstName
            ? `${review.reviewer.firstName}${review.reviewer.lastName ? ` ${review.reviewer.lastName.slice(0, 1)}.` : ''}`
            : 'Verified buyer',
        })),
      })),
    };
  }
}
