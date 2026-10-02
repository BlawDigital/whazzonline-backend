import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';

import { PrismaService } from 'prisma/prisma.service';
import { productSku } from '../common/product-sku';

type StoredVariant = {
  color?: string;
  imageIndexes?: number[];
  quantity?: number;
  size?: string;
  type?: string;
};

const COLOR_SWATCHES: Record<string, string> = {
  black: '#111111',
  blue: '#2563EB',
  brown: '#8B5E3C',
  green: '#16A34A',
  grey: '#808080',
  orange: '#F97316',
  pink: '#EC4899',
  purple: '#9333EA',
  red: '#DC2626',
  white: '#FFFFFF',
  yellow: '#EAB308',
};

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
      imageUris: product.imageUrls,
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
    const colors = [
      ...new Set(variants.map((item) => item.color).filter(Boolean)),
    ] as string[];
    const sizes = [
      ...new Set(variants.map((item) => item.size).filter(Boolean)),
    ] as string[];
    const legacy = variants.filter(
      (variant) => variant.type && !variant.color && !variant.size,
    );
    const variantGroups = [
      ...(colors.length
        ? [
            {
              displayType: 'swatch' as const,
              id: 'color',
              label: 'Color',
              options: colors.map((color) => {
                const matching = variants.filter(
                  (item) => item.color === color,
                );
                const indexes = [
                  ...new Set(
                    matching.flatMap((item) => item.imageIndexes ?? []),
                  ),
                ];
                return {
                  available: matching.some((item) => (item.quantity ?? 0) > 0),
                  id: color.toLowerCase().replace(/\s+/g, '-'),
                  imageUris: indexes
                    .map((index) => product.imageUrls[index])
                    .filter(Boolean),
                  label: color,
                  swatchHex: COLOR_SWATCHES[color.toLowerCase()],
                  value: color,
                };
              }),
            },
          ]
        : []),
      ...(sizes.length
        ? [
            {
              displayType: 'pill' as const,
              id: 'size',
              label: 'Size',
              options: sizes.map((size) => ({
                available: variants.some(
                  (item) => item.size === size && (item.quantity ?? 0) > 0,
                ),
                id: size.toLowerCase().replace(/\s+/g, '-'),
                label: size,
                value: size,
              })),
            },
          ]
        : []),
      ...(legacy.length
        ? [
            {
              displayType: 'pill' as const,
              id: 'variant',
              label: 'Variant',
              options: legacy.map((variant) => ({
                available: (variant.quantity ?? 0) > 0,
                id: String(variant.type).toLowerCase().replace(/\s+/g, '-'),
                label: String(variant.type),
                value: String(variant.type),
              })),
            },
          ]
        : []),
    ];
    const specifications =
      typeof product.specifications === 'object' &&
      product.specifications !== null &&
      !Array.isArray(product.specifications)
        ? Object.entries(product.specifications)
            .map(
              ([label, value]) =>
                `${label}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
            )
            .join('\n')
        : '';
    const description = product.description || 'No description provided.';
    return {
      availableQuantity: product.quantity,
      description,
      pattern: specifications || description,
      productId: product.id,
      imageUris: product.imageUrls,
      recommendations: recommendations.map((item) => this.mapProduct(item)),
      specification: specifications || description,
      style: description,
      variantCombinations: variants.map((variant) => ({
        available: (variant.quantity ?? 0) > 0,
        quantity: variant.quantity ?? 0,
        values: {
          ...(variant.color ? { color: variant.color } : {}),
          ...(variant.size ? { size: variant.size } : {}),
          ...(variant.type ? { variant: variant.type } : {}),
        },
      })),
      variantGroups,
      vendorId: vendorId ?? '',
    };
  }
}
