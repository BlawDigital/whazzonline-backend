import { Injectable } from '@nestjs/common';

import { PrismaService } from 'prisma/prisma.service';

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
    const products = await this.prisma.product.findMany({
      where: { status: 'ACTIVE', vendorProfile: { setupCompleted: true } },
      include: {
        vendorProfile: {
          select: { city: true, state: true, storeName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      categories,
      products: products.map((product) => ({
        category: categoryFor(product.category),
        dateListed: dateListed(product.createdAt),
        id: product.id,
        imageUri: product.imageUrls[0] ?? '',
        imageUrls: product.imageUrls,
        location: `${product.vendorProfile.city}, ${product.vendorProfile.state}`,
        name: product.name,
        price: `₦${product.unitPrice.toLocaleString()}`,
        seller: product.vendorProfile.storeName,
        sku: product.id,
        description: product.description,
        specifications: product.specifications,
        variants: product.variants,
      })),
    };
  }
}
