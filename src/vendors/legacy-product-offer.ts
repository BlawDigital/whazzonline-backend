import type { Product } from 'generated/prisma/client';
import type { Prisma } from 'generated/prisma/client';
export function legacyPromotionWhere(now: Date): Prisma.ProductWhereInput {
  return {
    status: 'ACTIVE',
    promoPrice: { not: null },
    promoStartsAt: { lte: now },
    promoEndsAt: { gt: now },
    offers: {
      none: {
        offer: {
          status: { not: 'DRAFT' },
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
      },
    },
  };
}
export function legacyProductOffer(
  product: Pick<
    Product,
    'id' | 'name' | 'promoPrice' | 'promoStartsAt' | 'promoEndsAt' | 'imageUrls'
  >,
) {
  return {
    id: `product-${product.id}`,
    name: product.name,
    type: 'PRICE_DISCOUNT' as const,
    status: 'ACTIVE' as const,
    discountType: 'FIXED_PRICE' as const,
    discountValue: product.promoPrice,
    startsAt: product.promoStartsAt,
    endsAt: product.promoEndsAt,
    mediaUrls: product.imageUrls,
    description: null,
    bundlePrice: null,
    deliveryType: null,
    deliveryFee: null,
    minimumOrderValue: null,
    applicableLocations: [],
    stockLimit: null,
    unitsClaimed: 0,
  };
}
