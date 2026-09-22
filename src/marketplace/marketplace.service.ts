import { Injectable } from '@nestjs/common';

import { PrismaService } from 'prisma/prisma.service';
import { productSku } from '../common/product-sku';

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
          _count: { select: { likes: true } },
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
          bannerUrl: true,
          category: true,
          city: true,
          description: true,
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

    const now = new Date();
    return {
      categories,
      products: products.map((product) => {
        const promoPrice = product.promoPrice;
        const offerActive = Boolean(
          promoPrice &&
          product.promoStartsAt &&
          product.promoEndsAt &&
          product.promoStartsAt <= now &&
          product.promoEndsAt > now,
        );
        return {
          category: categoryFor(product.category),
          dateListed: dateListed(product.createdAt),
          id: product.id,
          likeCount: product._count?.likes ?? 0,
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
          offerEndsAt: offerActive
            ? product.promoEndsAt?.toISOString()
            : undefined,
          seller: product.vendorProfile.storeName,
          vendorId: product.vendorProfile.userId,
          sku: productSku(product.id),
          description: product.description,
          specifications: product.specifications,
          variants: product.variants,
        };
      }),
      vendors: vendors.map((vendor) => ({
        category: vendor.category,
        coverUri: vendor.bannerUrl ?? '',
        description: vendor.description,
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
