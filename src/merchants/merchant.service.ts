import type { ProductReview } from 'generated/prisma/client';
import {
  legacyProductOffer,
  legacyPromotionWhere,
} from '../vendors/legacy-product-offer';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import {
  NotificationsQuery,
  AisleDto,
  ContentDto,
  FeedDto,
  ProductReviewDto,
  ProductReviewsQuery,
  UpdateContentDto,
} from './merchant.dto';
import { uploadMerchantMedia, uploadStoryMusic } from './merchant-media';
import { cloudinaryClient } from '../storage/cloudinary-storage';
import {
  orderNotificationSelect,
  orderNotices,
  supportReplyNotice,
  supportReplySelect,
} from '../commerce/order-notifications';

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
    const storyCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const where = {
      OR: [{ kind: { not: 'STORY' } }, { createdAt: { gt: storyCutoff } }],
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
    const rows = [...first, ...rest];
    const storyCounts =
      query.kind === 'STORY' && rows.length
        ? await this.prisma.merchantContent.groupBy({
            by: ['merchantId'],
            where: {
              ...where,
              kind: 'STORY',
              merchantId: {
                in: [...new Set(rows.map((row) => row.merchantId))],
              },
            },
            _count: { _all: true },
          })
        : [];
    const counts = new Map(
      storyCounts.map((row) => [row.merchantId, row._count._all]),
    );
    const activeStories =
      query.kind === 'STORY' && rows.length
        ? await this.prisma.merchantContent.findMany({
            where: {
              ...where,
              kind: 'STORY',
              merchantId: {
                in: [...new Set(rows.map((row) => row.merchantId))],
              },
            },
            select: { id: true, merchantId: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        : [];
    const storyIds = new Map<string, string[]>();
    for (const story of activeStories) {
      const ids = storyIds.get(story.merchantId) ?? [];
      ids.push(story.id);
      storyIds.set(story.merchantId, ids);
    }
    return {
      items: rows.map(({ mediaPublicId, musicPublicId, ...row }) => {
        // The storage identifier is for owner-side cleanup only.
        void mediaPublicId;
        void musicPublicId;
        return {
          ...row,
          expiresAt:
            row.kind === 'STORY'
              ? new Date(
                  row.createdAt.getTime() + 24 * 60 * 60 * 1000,
                ).toISOString()
              : null,
          activeStoryCount: counts.get(row.merchantId),
          activeStoryIds: storyIds.get(row.merchantId),
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
    musicFile?: Express.Multer.File,
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
    if (musicFile && dto.kind !== 'STORY')
      throw new BadRequestException('Music can only be added to Stories.');
    const media = await uploadMerchantMedia(file);
    let music: Awaited<ReturnType<typeof uploadStoryMusic>> | undefined;
    try {
      if (musicFile) music = await uploadStoryMusic(musicFile);
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
          ...(music
            ? { musicUrl: music.url, musicPublicId: music.publicId }
            : {}),
        },
      });
    } catch (error) {
      if (music)
        await cloudinaryClient()
          .uploader.destroy(music.publicId, { resource_type: 'video' })
          .catch(() => undefined);
      await cloudinaryClient()
        .uploader.destroy(media.publicId, { resource_type: media.resourceType })
        .catch(() => undefined);
      throw error;
    }
  }
  async updateContent(
    userId: string,
    id: string,
    dto: UpdateContentDto,
    file?: Express.Multer.File,
    musicFile?: Express.Multer.File,
  ) {
    const content = await this.prisma.merchantContent.findUnique({
      where: { id },
      include: { merchant: { select: { userId: true } } },
    });
    if (!content) throw new NotFoundException('Content not found.');
    if (content.merchant.userId !== userId)
      throw new ForbiddenException('You can only update your own content.');
    await this.merchant(userId, true);
    if (dto.title !== undefined && dto.title.trim().length < 2)
      throw new BadRequestException(
        'Add a title with at least two characters.',
      );
    if (
      file &&
      content.kind === 'SCROLL' &&
      !file.mimetype.startsWith('video/')
    )
      throw new BadRequestException('SCROLL requires a video.');
    if (musicFile && content.kind !== 'STORY')
      throw new BadRequestException('Music can only be added to Stories.');
    const media = file ? await uploadMerchantMedia(file) : undefined;
    let music: Awaited<ReturnType<typeof uploadStoryMusic>> | undefined;
    try {
      if (musicFile) music = await uploadStoryMusic(musicFile);
      const updated = await this.prisma.merchantContent.update({
        where: { id },
        data: {
          ...(music
            ? { musicUrl: music.url, musicPublicId: music.publicId }
            : dto.removeMusic === 'true'
              ? { musicUrl: null, musicPublicId: null }
              : {}),
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.caption !== undefined ? { caption: dto.caption.trim() } : {}),
          ...(dto.topic !== undefined ? { topic: dto.topic } : {}),
          ...(media
            ? {
                mediaUrl: media.mediaUrl,
                mediaType: media.mediaType,
                mediaPublicId: media.publicId,
              }
            : {}),
        },
      });
      if (media)
        await cloudinaryClient()
          .uploader.destroy(content.mediaPublicId, {
            resource_type: content.mediaType === 'VIDEO' ? 'video' : 'image',
          })
          .catch(() => undefined);
      if ((music || dto.removeMusic === 'true') && content.musicPublicId)
        await cloudinaryClient()
          .uploader.destroy(content.musicPublicId, { resource_type: 'video' })
          .catch(() => undefined);
      return updated;
    } catch (error) {
      if (music)
        await cloudinaryClient()
          .uploader.destroy(music.publicId, { resource_type: 'video' })
          .catch(() => undefined);
      if (media)
        await cloudinaryClient()
          .uploader.destroy(media.publicId, {
            resource_type: media.resourceType,
          })
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
    if (content.musicPublicId)
      await cloudinaryClient()
        .uploader.destroy(content.musicPublicId, { resource_type: 'video' })
        .catch(() => undefined);
    return { deleted: true };
  }
  async offers(userId: string | null, explore = false) {
    const now = new Date();
    const offers = await this.prisma.offer.findMany({
      where: {
        status: { in: ['ACTIVE', 'SCHEDULED'] },
        startsAt: { lte: now },
        endsAt: { gt: now },
        vendorProfile: {
          setupCompleted: true,
          user: { isActive: true },
          ...(explore
            ? userId
              ? { userId: { not: userId } }
              : {}
            : { contacts: { some: { userId: userId! } } }),
        },
      },
      include: {
        products: {
          where: { product: { status: 'ACTIVE' } },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                status: true,
                imageUrls: true,
                unitPrice: true,
                quantity: true,
                category: true,
              },
            },
          },
        },
        vendorProfile: {
          select: {
            userId: true,
            storeName: true,
            logoUrl: true,
            bannerUrl: true,
            description: true,
            city: true,
            state: true,
            category: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const legacy = await this.prisma.product.findMany({
      where: {
        ...legacyPromotionWhere(now),
        vendorProfile: {
          setupCompleted: true,
          user: { isActive: true },
          ...(explore
            ? userId
              ? { userId: { not: userId } }
              : {}
            : { contacts: { some: { userId: userId! } } }),
        },
      },
      select: {
        id: true,
        name: true,
        status: true,
        unitPrice: true,
        quantity: true,
        imageUrls: true,
        category: true,
        promoPrice: true,
        promoStartsAt: true,
        promoEndsAt: true,
        vendorProfile: {
          select: {
            userId: true,
            storeName: true,
            logoUrl: true,
            bannerUrl: true,
            description: true,
            city: true,
            state: true,
            category: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return [
      ...offers.filter(
        (offer) =>
          offer.stockLimit === null || offer.unitsClaimed < offer.stockLimit,
      ),
      ...legacy.map(({ vendorProfile, ...product }) => ({
        ...legacyProductOffer(product),
        vendorProfile,
        products: [{ product }],
      })),
    ];
  }
  async notifications(userId: string, query?: NotificationsQuery) {
    const [
      orders,
      posts,
      reads,
      supportReplies,
      offers,
      promotions,
      inventory,
    ] = await Promise.all([
      this.prisma.commerceOrder.findMany({
        where: { OR: [{ userId }, { items: { some: { vendorId: userId } } }] },
        select: orderNotificationSelect,
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      this.prisma.merchantContent.findMany({
        where: {
          OR: [
            { kind: { not: 'STORY' } },
            { createdAt: { gt: new Date(Date.now() - 86400000) } },
          ],
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
          topic: true,
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
        where: {
          ticket: { ownerUserId: userId },
          senderUserId: { not: userId },
        },
        select: supportReplySelect,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.offer.findMany({
        where: {
          status: { in: ['ACTIVE', 'SCHEDULED'] },
          startsAt: { lte: new Date() },
          endsAt: { gt: new Date() },
          vendorProfile: {
            setupCompleted: true,
            user: { isActive: true },
            OR: [{ userId }, { contacts: { some: { userId } } }],
          },
        },
        select: {
          id: true,
          name: true,
          description: true,
          startsAt: true,
          vendorProfile: { select: { userId: true, storeName: true } },
        },
        orderBy: { startsAt: 'desc' },
        take: 100,
      }),
      this.prisma.product.findMany({
        where: {
          ...legacyPromotionWhere(new Date()),
          vendorProfile: {
            setupCompleted: true,
            user: { isActive: true },
            OR: [{ userId }, { contacts: { some: { userId } } }],
          },
        },
        select: {
          id: true,
          name: true,
          promoStartsAt: true,
          vendorProfile: { select: { userId: true, storeName: true } },
        },
        orderBy: { promoStartsAt: 'desc' },
        take: 100,
      }),
      this.prisma.product.findMany({
        where: {
          status: 'ACTIVE',
          quantity: { lte: 5 },
          vendorProfile: { userId },
        },
        select: { id: true, name: true, quantity: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
    ]);
    const keys = new Set(reads.map((row) => row.key));
    const notices = [
      ...orders
        .flatMap((order) => orderNotices(order, userId))
        .map((n) => ({ ...n, category: 'orders' })),
      ...supportReplies
        .map(supportReplyNotice)
        .map((n) => ({ ...n, category: n.orderId ? 'orders' : 'system' })),
      ...posts.map((post) => ({
        id: `merchant-content:${post.id}`,
        category: post.topic === 'OFFER' ? 'promotions' : 'system',
        type: post.kind.toLowerCase(),
        title: `${post.merchant.storeName} · ${post.kind === 'STORY' ? 'Story' : 'SCROLL'}`,
        body: post.title,
        createdAt: post.createdAt.toISOString(),
        orderId: undefined as string | undefined,
        merchantId: post.merchant.userId,
        read: false,
      })),
      ...offers.map((offer) => ({
        id: `offer:${offer.id}`,
        category: 'offers',
        type: 'offer',
        title: `${offer.vendorProfile.storeName} · New offer`,
        body:
          offer.name ||
          offer.description ||
          'An offer is available. View the offer for details.',
        createdAt: offer.startsAt.toISOString(),
        merchantId: offer.vendorProfile.userId,
        offerId: offer.id,
        read: false,
      })),
      ...promotions.map((product) => ({
        id: `promotion:${product.id}:${product.promoStartsAt!.getTime()}`,
        category: 'promotions',
        type: 'promotion',
        title: `${product.vendorProfile.storeName} · Promotion`,
        body: `${product.name} is on promotion.`,
        createdAt: product.promoStartsAt!.toISOString(),
        merchantId: product.vendorProfile.userId,
        productId: product.id,
        read: false,
      })),
      ...inventory.map((product) => ({
        id: `inventory:${product.id}:${product.updatedAt.getTime()}`,
        category: 'system',
        type: 'inventory',
        title: 'Inventory alert',
        body: `${product.name} has ${product.quantity} ${product.quantity === 1 ? 'unit' : 'units'} left in stock.`,
        createdAt: product.updatedAt.toISOString(),
        merchantId: userId,
        productId: product.id,
        read: false,
      })),
    ]
      .map((notice) => ({
        ...notice,
        read: notice.read || keys.has(notice.id),
      }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const filtered = notices.filter(
      (n) =>
        !query?.category ||
        query.category === 'all' ||
        n.category === query.category,
    );
    const offset = query?.offset || 0;
    const limit = query?.limit ?? filtered.length;
    return {
      notifications: filtered.slice(offset, offset + limit),
      total: filtered.length,
      hasMore: offset + limit < filtered.length,
      unreadCount: notices.filter((notice) => !notice.read).length,
    };
  }
  async readNotifications(userId: string, id?: string) {
    const feed = await this.notifications(userId);
    if (id && !feed.notifications.some((n) => n.id === id))
      throw new NotFoundException('Notification not found in your account.');
    await this.prisma.sellerNotificationRead.createMany({
      data: feed.notifications
        .filter((row) => !row.read && (!id || row.id === id))
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
  async reviews(
    id: string,
    query: ProductReviewsQuery = new ProductReviewsQuery(),
  ) {
    await this.product(id);
    const search = query.search.trim();
    const where = {
      productId: id,
      ...(search
        ? {
            OR: [
              { comment: { contains: search, mode: 'insensitive' as const } },
              {
                user: {
                  firstName: { contains: search, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    };
    const [items, stats, distribution, total] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({
        where,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          mediaUrl: true,
          mediaType: true,
          user: {
            select: { firstName: true, lastName: true, avatarUrl: true },
          },
        },
        orderBy:
          query.sort === 'recent'
            ? [{ createdAt: 'desc' }, { id: 'desc' }]
            : [
                { rating: query.sort === 'highest' ? 'desc' : 'asc' },
                { createdAt: 'desc' },
                { id: 'desc' },
              ],
        skip: query.offset,
        take: query.limit,
      }),
      this.prisma.productReview.aggregate({
        where: { productId: id },
        _avg: { rating: true },
        _count: true,
      }),
      this.prisma.productReview.groupBy({
        by: ['rating'],
        orderBy: { rating: 'asc' },
        where: { productId: id },
        _count: true,
      }),
      this.prisma.productReview.count({ where }),
    ]);
    const voteCounts = await this.prisma.productReviewVote.groupBy({
      by: ['reviewId', 'helpful'],
      where: { reviewId: { in: items.map((i) => i.id) } },
      _count: true,
    });
    return {
      items: items.map(({ user, ...item }) => ({
        ...item,
        user: {
          firstName: user.firstName,
          avatarUrl: user.avatarUrl,
          lastName: user.lastName?.slice(0, 1),
        },
        helpfulCount:
          voteCounts.find((v) => v.reviewId === item.id && v.helpful)?._count ??
          0,
        notHelpfulCount:
          voteCounts.find((v) => v.reviewId === item.id && !v.helpful)
            ?._count ?? 0,
      })),
      average: stats._avg.rating ?? 0,
      total: stats._count,
      filteredTotal: total,
      distribution: Object.fromEntries(
        distribution.map((row) => [row.rating, row._count]),
      ),
      hasMore: query.offset + items.length < total,
    };
  }
  async reviewViewer(userId: string, id: string) {
    const product = await this.product(id);
    const [purchase, votes, ownReview] = await Promise.all([
      this.prisma.commerceOrderItem.findFirst({
        where: { productId: id, order: { userId, status: 'delivered' } },
        select: { id: true },
      }),
      this.prisma.productReviewVote.findMany({
        where: { userId, review: { productId: id } },
        select: { reviewId: true, helpful: true },
      }),
      this.prisma.productReview.findUnique({
        where: { productId_userId: { productId: id, userId } },
        select: { id: true },
      }),
    ]);
    return {
      isOwner: product.vendorProfile.userId === userId,
      canReview: product.vendorProfile.userId !== userId && !!purchase,
      ownReviewId: ownReview?.id ?? null,
      votes: Object.fromEntries(votes.map((v) => [v.reviewId, v.helpful])),
    };
  }
  async voteProductReview(
    userId: string,
    productId: string,
    reviewId: string,
    helpful: boolean | null,
  ) {
    await this.product(productId);
    const review = await this.prisma.productReview.findFirst({
      where: { id: reviewId, productId },
      select: { userId: true },
    });
    if (!review)
      throw new NotFoundException('Review not found for this product.');
    if (review.userId === userId)
      throw new ForbiddenException('You cannot vote on your own review.');
    const where = { userId_reviewId: { userId, reviewId } };
    if (helpful === null)
      await this.prisma.productReviewVote.deleteMany({
        where: { userId, reviewId },
      });
    else
      await this.prisma.productReviewVote.upsert({
        where,
        create: { userId, reviewId, helpful },
        update: { helpful },
      });
    const counts = await this.prisma.productReviewVote.groupBy({
      by: ['helpful'],
      where: { reviewId },
      _count: true,
    });
    return {
      viewerVote: helpful,
      helpfulCount: counts.find((c) => c.helpful)?._count ?? 0,
      notHelpfulCount: counts.find((c) => !c.helpful)?._count ?? 0,
    };
  }
  async review(
    userId: string,
    id: string,
    dto: ProductReviewDto,
    file?: Express.Multer.File,
  ) {
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
    const previousMedia = file
      ? await this.prisma.productReview.findUnique({
          where: { productId_userId: { productId: id, userId } },
          select: { mediaPublicId: true, mediaType: true },
        })
      : null;
    const media = file ? await uploadMerchantMedia(file) : undefined;
    let saved: Pick<
      ProductReview,
      'id' | 'rating' | 'comment' | 'createdAt' | 'mediaUrl' | 'mediaType'
    >;
    try {
      saved = await this.prisma.productReview.upsert({
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          mediaUrl: true,
          mediaType: true,
        },
        where: { productId_userId: { productId: id, userId } },
        create: {
          productId: id,
          userId,
          rating: dto.rating,
          comment: dto.comment.trim(),
          ...(media
            ? {
                mediaUrl: media.mediaUrl,
                mediaType: media.mediaType,
                mediaPublicId: media.publicId,
              }
            : {}),
        },
        update: {
          rating: dto.rating,
          comment: dto.comment.trim(),
          ...(media
            ? {
                mediaUrl: media.mediaUrl,
                mediaType: media.mediaType,
                mediaPublicId: media.publicId,
              }
            : {}),
        },
      });
    } catch (error) {
      if (media) {
        try {
          await cloudinaryClient().uploader.destroy(media.publicId, {
            resource_type: media.resourceType,
          });
        } catch {
          /* Keep the original database error. */
        }
      }
      throw error;
    }
    if (media && previousMedia?.mediaPublicId) {
      try {
        await cloudinaryClient().uploader.destroy(previousMedia.mediaPublicId, {
          resource_type:
            previousMedia.mediaType === 'VIDEO' ? 'video' : 'image',
        });
      } catch {
        /* Replaced media cleanup can be retried without failing a saved review. */
      }
    }
    return saved;
  }
}
