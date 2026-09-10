import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';

import { PrismaService } from 'prisma/prisma.service';
import { productSku } from '../common/product-sku';

type StoredVariant = { quantity?: number; type?: string };

@Controller('products')
export class ProductsController {
  constructor(private readonly prisma: PrismaService) {}

  private mapProduct(product: {
    id: string;
    imageUrls: string[];
    name: string;
    promoEndsAt: Date | null;
    promoPrice: number | null;
    promoStartsAt: Date | null;
    unitPrice: number;
  }) {
    const now = new Date();
    const activeOffer = Boolean(
      product.promoPrice &&
        product.promoStartsAt &&
        product.promoEndsAt &&
        product.promoStartsAt <= now &&
        product.promoEndsAt > now,
    );
    return {
      detailTitle: product.name,
      id: product.id,
      imageUri: product.imageUrls[0] ?? '',
      name: product.name,
      price: `₦${product.unitPrice.toLocaleString()}`,
      salePrice: activeOffer
        ? `₦${product.promoPrice?.toLocaleString()}`
        : undefined,
      sku: productSku(product.id),
    };
  }

  @Get()
  async list() {
    const products = await this.prisma.product.findMany({
      where: { status: 'ACTIVE', vendorProfile: { setupCompleted: true } },
      orderBy: { createdAt: 'desc' },
    });
    return products.map((product) => this.mapProduct(product));
  }

  @Get(':productId/configuration')
  async configuration(
    @Param('productId') productId: string,
    @Query('vendorId') vendorId?: string,
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        status: 'ACTIVE',
        ...(vendorId ? { vendorProfile: { userId: vendorId } } : {}),
      },
    });
    if (!product) throw new NotFoundException('Product not found.');
    const recommendations = await this.prisma.product.findMany({
      where: {
        category: product.category,
        id: { not: product.id },
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    const variants = Array.isArray(product.variants)
      ? (product.variants as StoredVariant[])
      : [];
    const variantOptions = variants
      .filter((variant) => variant.type)
      .map((variant) => ({
        available: (variant.quantity ?? 0) > 0,
        id: String(variant.type).toLowerCase().replace(/\s+/g, '-'),
        label: String(variant.type),
        value: String(variant.type),
      }));
    const specifications =
      typeof product.specifications === 'object' &&
      product.specifications !== null &&
      !Array.isArray(product.specifications)
        ? Object.entries(product.specifications)
            .map(([label, value]) => `${label}: ${String(value)}`)
            .join('\n')
        : '';
    const description = product.description || 'No description provided.';
    return {
      description,
      pattern: specifications || description,
      productId: product.id,
      recommendations: recommendations.map((item) => this.mapProduct(item)),
      specification: specifications || description,
      style: description,
      variantGroups: variantOptions.length
        ? [
            {
              displayType: 'pill',
              id: 'variant',
              label: 'Variant',
              options: variantOptions,
            },
          ]
        : [],
      vendorId: vendorId ?? '',
    };
  }
}
