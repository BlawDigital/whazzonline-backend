import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import {
  AisleDto,
  ContentDto,
  FeedDto,
  ProductReviewDto,
} from './merchant.dto';
import { uploadMerchantMedia } from './merchant-media';
import { cloudinaryClient } from '../storage/cloudinary-storage';
import { orderNotificationSelect, orderNotices, supportReplyNotice, supportReplySelect } from '../commerce/order-notifications';

@Injectable()
export class MerchantService {
  constructor(private readonly prisma: PrismaService) {}
  private async merchant(userId: string, owner = false) {
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: { registrationType: true, role: true, isActive: true },
        },
      },
    });
    if (
      !profile ||
      !profile.user.isActive ||
      (!owner && !profile.setupCompleted)
    )
      throw new NotFoundException('Merchant not found.');
    return profile;
  }
  private isBusiness(
    profile: Awaited<ReturnType<MerchantService['merchant']>>,
  ) {
    return (
      profile.user.registrationType === 'BUSINESS' ||
      profile.user.role === 'BUSINESS'
    );
  }
  async contacts(userId: string) {
    const rows = await this.prisma.merchantContact.findMany({
      where: {
        userId,
        merchant: { setupCompleted: true, user: { isActive: true } },
      },
      select: { merchant: { select: { userId: true } } },
    });
    return { merchantIds: rows.map((row) => row.merchant.userId) };
  }
  async saveContact(userId: string, id: string) {
    if (id === userId)
      throw new BadRequestException(
        'You cannot save yourself as a merchant contact.',
      );
    const profile = await this.merchant(id);
    await this.prisma.merchantContact.upsert({
      where: { userId_merchantId: { userId, merchantId: profile.id } },
      create: { userId, merchantId: profile.id },
      update: {},
    });
    return { saved: true };
  }
  async removeContact(userId: string, id: string) {
    const profile = await this.merchant(id);
    await this.prisma.merchantContact.deleteMany({
      where: { userId, merchantId: profile.id },
    });
    return { saved: false };
  }
  async feed(userId: string | undefined, query: FeedDto) {
    const contacts = userId
      ? await this.prisma.merchantContact.findMany({
          where: { userId },
          select: { merchantId: true },
        })
      : [];
    const trusts = userId
      ? await this.prisma.vendorTrustReview.findMany({
          where: { reviewerUserId: userId },
          select: { vendorProfileId: true },
        })
      : [];
    const saved = contacts.map((row) => row.merchantId);
    const trusted = [
      ...new Set([...saved, ...trusts.map((row) => row.vendorProfileId)]),
    ];
    const where = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.savedOnly === 'true' ? { merchantId: { in: saved } } : {}),
      merchant: {
        ...(query.merchantId ? { userId: query.merchantId } : {}),
        setupCompleted: true,
        user: { isActive: true },
        ...(query.verified === 'true'
          ? { reviewStatus: 'APPROVED' as const }
          : {}),
      },
    };
    const include = {
      merchant: {
        select: {
          userId: true,
          storeName: true,
          logoUrl: true,
          reviewStatus: true,
        },
      },
    };
    // Paginate the trusted partition first, then discovery, without fetching an unbounded feed.
    const priority = { ...where, AND: [{ merchantId: { in: trusted } }] };
    const priorityCount = await this.prisma.merchantContent.count({
      where: priority,
    });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 20;
    const first =
      offset < priorityCount
        ? await this.prisma.merchantContent.findMany({
            where: priority,
            include,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: offset,
            take: limit,
          })
        : [];
    const rest =
      first.length < limit
        ? await this.prisma.merchantContent.findMany({
            where: { ...where, AND: [{ merchantId: { notIn: trusted } }] },
            include,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: Math.max(0, offset - priorityCount),
            take: limit - first.length,
          })
        : [];
    return {
      items: [...first, ...rest].map(({ mediaPublicId, ...row }) => {
        // The storage identifier is for owner-side cleanup only.
        void mediaPublicId;
        return {
          ...row,
          saved: saved.includes(row.merchantId),
          trusted: trusted.includes(row.merchantId),
        };
      }),
      hasMore:
        offset + first.length + rest.length <
        (await this.prisma.merchantContent.count({ where })),
    };
  }
  async createContent(
    userId: string,
    dto: ContentDto,
    file?: Express.Multer.File,
  ) {
    const profile = await this.merchant(userId, true);
    if (profile.user.registrationType !== 'SELLER' && !this.isBusiness(profile))
      throw new ForbiddenException('A merchant account is required.');
    if (dto.kind === 'SCROLL' && !this.isBusiness(profile))
      throw new ForbiddenException('SCROLL is available to business accounts.');
    if (!profile.setupCompleted)
      throw new BadRequestException('Complete your merchant profile first.');
    if (!file) throw new BadRequestException('Add a media file.');
    if (dto.kind === 'SCROLL' && !file.mimetype.startsWith('video/'))
      throw new BadRequestException('SCROLL requires a video.');
    if (!dto.title.trim() || (dto.caption && !dto.caption.trim()))
      throw new BadRequestException('Content cannot contain only spaces.');
    const media = await uploadMerchantMedia(file);
    try {
      return await this.prisma.merchantContent.create({
        data: {
          merchantId: profile.id,
          kind: dto.kind,
          topic: dto.topic ?? 'UPDATE',
          title: dto.title.trim(),
          caption: dto.caption?.trim() ?? '',
          mediaUrl: media.mediaUrl,
          mediaType: media.mediaType,
          mediaPublicId: media.publicId,
        },
      });
    } catch (error) {
      await cloudinaryClient()
        .uploader.destroy(media.publicId, { resource_type: media.resourceType })
        .catch(() => undefined);
      throw error;
    }
  }
  async removeContent(userId: string, id: string) {
    const content = await this.prisma.merchantContent.findUnique({
      where: { id },
      include: { merchant: { select: { userId: true } } },
    });
    if (!content) throw new NotFoundException('Content not found.');
    if (content.merchant.userId !== userId)
      throw new ForbiddenException('You can only remove your own content.');
    await this.prisma.merchantContent.delete({ where: { id } });
    await cloudinaryClient()
      .uploader.destroy(content.mediaPublicId, {
        resource_type: content.mediaType === 'VIDEO' ? 'video' : 'image',
      })
      .catch(() => undefined);
    return { deleted: true };
  }
  async offers(userId: string) {
    const now = new Date();
    return this.prisma.offer.findMany({
      where: {
        status: { in: ['ACTIVE', 'SCHEDULED'] },
        startsAt: { lte: now },
        endsAt: { gt: now },
        vendorProfile: {
          setupCompleted: true,
          user: { isActive: true },
          contacts: { some: { userId } },
        },
      },
      include: {
        products: {
          where: { product: { status: 'ACTIVE' } },
          include: {
            product: { select: { id: true, name: true, status: true } },
          },
        },
        vendorProfile: { select: { userId: true, storeName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async notifications(userId: string) {
    const [orders, posts, reads, supportReplies] = await Promise.all([
      this.prisma.commerceOrder.findMany({
        where: { OR: [{ userId }, { items: { some: { vendorId: userId } } }] },
        select: orderNotificationSelect,
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      this.prisma.merchantContent.findMany({
        where: {
          merchant: {
            contacts: { some: { userId } },
            setupCompleted: true,
            user: { isActive: true },
          },
        },
        select: {
          id: true,
          title: true,
          kind: true,
          createdAt: true,
          merchant: { select: { storeName: true, userId: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.sellerNotificationRead.findMany({
        where: { userId },
        select: { key: true },
      }),
      this.prisma.supportMessage.findMany({
        where: { ticket: { ownerUserId: userId }, senderUserId: { not: userId } },
        select: supportReplySelect, orderBy: { createdAt: 'desc' }, take: 100,
      }),
    ]);
    const keys = new Set(reads.map((row) => row.key));
    const notices = [
      ...orders.flatMap((order) => orderNotices(order, userId)),
      ...supportReplies.map(supportReplyNotice),
      ...posts.map((post) => ({
        id: `merchant-content:${post.id}`,
        title: `${post.merchant.storeName} · ${post.kind === 'STORY' ? 'Story' : 'SCROLL'}`,
        body: post.title,
        createdAt: post.createdAt.toISOString(),
        orderId: undefined as string | undefined,
        merchantId: post.merchant.userId,
        read: false,
      })),
    ]
      .map((notice) => ({ ...notice, read: notice.read || keys.has(notice.id) }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return {
      notifications: notices,
      unreadCount: notices.filter((notice) => !notice.read).length,
    };
  }
  async readNotifications(userId: string) {
    const feed = await this.notifications(userId);
    await this.prisma.sellerNotificationRead.createMany({
      data: feed.notifications
        .filter((row) => !row.read)
        .map((row) => ({ userId, key: row.id })),
      skipDuplicates: true,
    });
    return { success: true };
  }
  async aisles(id: string) {
    const profile = await this.merchant(id);
    return this.prisma.vendorCategory.findMany({
      where: { vendorProfileId: profile.id },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        parentId: true,
        _count: { select: { products: true } },
      },
    });
  }
  async createAisle(userId: string, dto: AisleDto) {
    const profile = await this.merchant(userId, true);
    if (dto.parentId && !this.isBusiness(profile))
      throw new ForbiddenException('Nested aisles require a business account.');
    if (
      dto.parentId &&
      !(await this.prisma.vendorCategory.findFirst({
        where: { id: dto.parentId, vendorProfileId: profile.id },
      }))
    )
      throw new BadRequestException(
        'Choose a parent aisle from your own store.',
      );
    if (dto.name.trim().length < 2)
      throw new BadRequestException('Enter an aisle name.');
    return this.prisma.vendorCategory.create({
      data: {
        name: dto.name.trim(),
        vendorProfileId: profile.id,
        parentId: dto.parentId,
      },
    });
  }
  async removeAisle(userId: string, id: string) {
    const profile = await this.merchant(userId, true);
    const aisle = await this.prisma.vendorCategory.findFirst({
      where: { id, vendorProfileId: profile.id },
    });
    if (!aisle) throw new NotFoundException('Aisle not found.');
    await this.prisma.vendorCategory.delete({ where: { id } });
    return { deleted: true };
  }
  async assignAisle(userId: string, id: string, aisleId?: string | null) {
    const profile = await this.merchant(userId, true);
    if (
      !(await this.prisma.product.findFirst({
        where: { id, vendorProfileId: profile.id },
      }))
    )
      throw new NotFoundException('Product not found in your store.');
    if (
      aisleId &&
      !(await this.prisma.vendorCategory.findFirst({
        where: { id: aisleId, vendorProfileId: profile.id },
      }))
    )
      throw new BadRequestException('Choose a category from your own store.');
    return this.prisma.product.update({
      where: { id },
      data: { aisleId: aisleId || null },
    });
  }
  private async product(id: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        vendorProfile: { setupCompleted: true, user: { isActive: true } },
      },
      include: { vendorProfile: { select: { userId: true } } },
    });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }
  async reviews(id: string) {
    await this.product(id);
    const [items, stats] = await Promise.all([
      this.prisma.productReview.findMany({
        where: { productId: id },
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          user: { select: { firstName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.productReview.aggregate({
        where: { productId: id },
        _avg: { rating: true },
        _count: true,
      }),
    ]);
    return { items, average: stats._avg.rating ?? 0, total: stats._count };
  }
  async review(userId: string, id: string, dto: ProductReviewDto) {
    const product = await this.product(id);
    if (product.vendorProfile.userId === userId)
      throw new ForbiddenException('You cannot review your own product.');
    if (dto.comment.trim().length < 3)
      throw new BadRequestException('Write a product comment.');
    const purchased = await this.prisma.commerceOrderItem.findFirst({
      where: { productId: id, order: { userId, status: 'delivered' } },
      select: { id: true },
    });
    if (!purchased)
      throw new ForbiddenException(
        'Reviews are available after a delivered purchase.',
      );
    return this.prisma.productReview.upsert({
      where: { productId_userId: { productId: id, userId } },
      create: {
        productId: id,
        userId,
        rating: dto.rating,
        comment: dto.comment.trim(),
      },
      update: { rating: dto.rating, comment: dto.comment.trim() },
    });
  }
}
