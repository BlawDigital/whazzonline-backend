import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { PrismaService } from 'prisma/prisma.service';

const webOrigin = () =>
  (process.env.FRONTEND_URL ?? 'https://whazzonline.com').replace(/\/$/, '');
const apiOrigin = () =>
  (process.env.PUBLIC_API_URL ?? 'https://api.whazzonline.com').replace(
    /\/$/,
    '',
  );

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}

function absoluteUrl(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  try {
    return new URL(value, apiOrigin()).href;
  } catch {
    return fallback;
  }
}

function shortDescription(value: string | null | undefined, fallback: string) {
  const text = value?.trim() || fallback;
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}...` : text;
}

function socialDocument({
  description,
  image,
  title,
  url,
}: {
  description: string;
  image: string;
  title: string;
  url: string;
}) {
  const safe = (value: string) => escapeHtml(value);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safe(title)}</title>
    <meta name="description" content="${safe(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Whazzonline" />
    <meta property="og:title" content="${safe(title)}" />
    <meta property="og:description" content="${safe(description)}" />
    <meta property="og:image" content="${safe(image)}" />
    <meta property="og:url" content="${safe(url)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safe(title)}" />
    <meta name="twitter:description" content="${safe(description)}" />
    <meta name="twitter:image" content="${safe(image)}" />
    <link rel="canonical" href="${safe(url)}" />
    <meta http-equiv="refresh" content="0;url=${safe(url)}" />
  </head>
  <body><a href="${safe(url)}">Open ${safe(title)}</a></body>
</html>`;
}

@Controller('share')
export class SharingController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('vendors/:vendorId')
  async vendor(@Param('vendorId') vendorId: string, @Res() response: Response) {
    const vendor = await this.prisma.vendorProfile.findFirst({
      where: { userId: vendorId, setupCompleted: true },
      select: {
        bannerUrl: true,
        description: true,
        logoUrl: true,
        storeName: true,
        userId: true,
      },
    });
    if (!vendor) throw new NotFoundException('Merchant not found.');

    const url = `${webOrigin()}/vendors/${encodeURIComponent(vendor.userId)}`;
    const image = absoluteUrl(
      vendor.bannerUrl ?? vendor.logoUrl,
      `${webOrigin()}/social-preview.png`,
    );
    return response
      .setHeader('Cache-Control', 'public, max-age=300')
      .type('html')
      .send(
        socialDocument({
          description: shortDescription(
            vendor.description,
            `Explore ${vendor.storeName} on Whazzonline.`,
          ),
          image,
          title: vendor.storeName,
          url,
        }),
      );
  }

  @Get('products/:vendorId/:productId')
  async product(
    @Param('vendorId') vendorId: string,
    @Param('productId') productId: string,
    @Res() response: Response,
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        status: 'ACTIVE',
        vendorProfile: { setupCompleted: true, userId: vendorId },
      },
      select: {
        id: true,
        imageUrls: true,
        name: true,
        unitPrice: true,
        vendorProfile: { select: { storeName: true, userId: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found.');

    const url = `${webOrigin()}/vendors/${encodeURIComponent(product.vendorProfile.userId)}/products/${encodeURIComponent(product.id)}`;
    const price = new Intl.NumberFormat('en-NG', {
      currency: 'NGN',
      maximumFractionDigits: 0,
      style: 'currency',
    }).format(product.unitPrice);
    return response
      .setHeader('Cache-Control', 'public, max-age=300')
      .type('html')
      .send(
        socialDocument({
          description: `${product.name} — ${price} from ${product.vendorProfile.storeName}.`,
          image: absoluteUrl(
            product.imageUrls[0],
            `${webOrigin()}/social-preview.png`,
          ),
          title: `${product.name} — ${price}`,
          url,
        }),
      );
  }
}
