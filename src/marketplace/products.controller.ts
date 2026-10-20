import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { PrismaService } from 'prisma/prisma.service';
import { productSku } from '../common/product-sku';
import type { AuthenticatedRequest } from 'src/auth/guards/authenticated-request';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

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
  constructor(private readonly prisma: PrismaService) { }

  private mapProduct(product: {
    id: string;
    imageUrls: string[];
    name: string;
    promoEndsAt: Date | null;
    promoPrice: number | null;
    promoStartsAt: Date | null;
    unitPrice: number;
    _count?: {
      likes?: number;
      comments?: number;
    };
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
      likeCount: product._count?.likes ?? 0,
      commentCount: product._count?.comments ?? 0,
    };
  }
  private getAuthenticatedUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.sub;

    if (!userId) {
      throw new UnauthorizedException('Authentication required.');
    }

    return userId;
  }

  private async assertActiveProduct(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    return product;
  }

  // GET /products/me/likes
  // Returns product IDs liked by the authenticated user.
  @UseGuards(JwtAuthGuard)
  @Get('me/likes')
  async getMyLikes(@Req() request: AuthenticatedRequest) {
    const userId = this.getAuthenticatedUserId(request);

    const likes = await this.prisma.productLike.findMany({
      where: { userId },
      select: { productId: true },
    });

    return {
      productIds: likes.map((like) => like.productId),
    };
  }

  // POST /products/:productId/like
  @UseGuards(JwtAuthGuard)
  @Post(':productId/like')
  async likeProduct(
    @Param('productId') productId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = this.getAuthenticatedUserId(request);

    await this.assertActiveProduct(productId);

    await this.prisma.productLike.upsert({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
      create: {
        userId,
        productId,
      },
      update: {},
    });

    const likeCount = await this.prisma.productLike.count({
      where: { productId },
    });

    return {
      liked: true,
      likeCount,
    };
  }

  // DELETE /products/:productId/like
  @UseGuards(JwtAuthGuard)
  @Delete(':productId/like')
  async unlikeProduct(
    @Param('productId') productId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = this.getAuthenticatedUserId(request);

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }

    await this.prisma.productLike.deleteMany({
      where: {
        userId,
        productId,
      },
    });

    const likeCount = await this.prisma.productLike.count({
      where: { productId },
    });

    return {
      liked: false,
      likeCount,
    };
  }

  @Get(':productId/comments')
  async getProductComments(@Param('productId') productId: string, @Query('cursor') cursor?: string) {
    await this.assertActiveProduct(productId);
    return this.prisma.productComment.findMany({
      where: { productId, parentId: null }, orderBy: [{ createdAt: 'desc' },{id:'desc'}], take: 50,
      ...(cursor ? {cursor:{id:cursor},skip:1} : {}),
      include: { user: {select: {id:true,firstName:true,lastName:true,avatarUrl:true}}, _count:{select:{likes:true,replies:true}} },
    });
  }

  @Get(':productId/comments/:commentId/replies')
  async getCommentReplies(@Param('productId') productId:string, @Param('commentId') commentId:string, @Query('cursor') cursor?:string) {
    await this.assertActiveProduct(productId);
    return this.prisma.productComment.findMany({
      where:{productId,parentId:commentId}, orderBy:[{createdAt:'asc'},{id:'asc'}], take:50,
      ...(cursor ? {cursor:{id:cursor},skip:1} : {}),
      include:{user:{select:{id:true,firstName:true,lastName:true,avatarUrl:true}},_count:{select:{likes:true,replies:true}}},
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get(':productId/comments/liked')
  async likedComments(@Param('productId') productId:string, @Req() request:AuthenticatedRequest) {
    const rows=await this.prisma.productCommentLike.findMany({where:{userId:this.getAuthenticatedUserId(request),comment:{productId}},select:{commentId:true}});
    return rows.map(row=>row.commentId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':productId/comments/:commentId/like')
  async likeComment(@Param('productId') productId:string,@Param('commentId') commentId:string,@Req() request:AuthenticatedRequest) {
    await this.assertActiveProduct(productId);
    const comment=await this.prisma.productComment.findFirst({where:{id:commentId,productId}});
    if(!comment) throw new NotFoundException('Comment not found.');
    const userId=this.getAuthenticatedUserId(request);
    await this.prisma.productCommentLike.upsert({where:{commentId_userId:{commentId,userId}},create:{commentId,userId},update:{}});
    return {liked:true};
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':productId/comments/:commentId/like')
  async unlikeComment(@Param('productId') productId:string,@Param('commentId') commentId:string,@Req() request:AuthenticatedRequest) {
    await this.prisma.productCommentLike.deleteMany({where:{commentId,userId:this.getAuthenticatedUserId(request),comment:{productId}}});
    return {liked:false};
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':productId/comments/:commentId')
  async deleteComment(@Param('productId') productId:string,@Param('commentId') commentId:string,@Req() request:AuthenticatedRequest) {
    const result=await this.prisma.productComment.deleteMany({where:{id:commentId,productId,userId:this.getAuthenticatedUserId(request)}});
    if(!result.count) throw new NotFoundException('Comment not found.');
    return {deleted:true};
  }

  // POST /products/:productId/comments
  @UseGuards(JwtAuthGuard)
  @Post(':productId/comments')
  async createProductComment(
    @Param('productId') productId: string,
    @Body('content') content: unknown,
    @Req() request: AuthenticatedRequest,
    @Body('parentId') parentId?: unknown,
  ) {
    const userId = this.getAuthenticatedUserId(request);

    if (typeof content !== 'string') {
      throw new BadRequestException('Comment content is required.');
    }

    const trimmedContent = content.trim();

    if (!trimmedContent) {
      throw new BadRequestException('Comment cannot be empty.');
    }

    if (trimmedContent.length > 2000) {
      throw new BadRequestException(
        'Comment cannot exceed 2000 characters.',
      );
    }

    await this.assertActiveProduct(productId);

    if (parentId !== undefined && (typeof parentId !== 'string' || !parentId)) throw new BadRequestException('Invalid reply.');
    let threadId: string | undefined;
    if (typeof parentId === 'string') {
      const parent = await this.prisma.productComment.findFirst({where:{id:parentId,productId}});
      if (!parent) throw new NotFoundException('The comment you are replying to was removed.');
      threadId = parent.parentId ?? parent.id;
    }

    return this.prisma.productComment.create({
      data: {
        productId,
        userId,
        content: trimmedContent,
        ...(threadId ? {parentId:threadId} : {}),
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    });
  }





  @Get()
  async list() {
    const products = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        vendorProfile: { setupCompleted: true },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
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