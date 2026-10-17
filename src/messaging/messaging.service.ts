import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { randomUUID } from 'node:crypto';
import { MessageKind, SendMessageDto } from './dto/send-message.dto';
import { ProductContextDto } from './dto/product-context.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { ConversationStatusValue } from './dto/update-conversation-status.dto';

const conversationInclude = {
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  vendorProfile: {
    select: {
      userId: true,
      logoUrl: true,
      storeName: true,
      reviewStatus: true,
    },
  },
  buyer: { select: { firstName: true, lastName: true, avatarUrl: true } },
};
type Conversation = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

@Injectable()
export class MessagingService {
  private readonly typingWindowMs = 8_000;
  private readonly typingByConversation = new Map<
    string,
    Map<string, number>
  >();

  constructor(private readonly prisma: PrismaService) {}
  private label(value: Date) {
    return new Intl.DateTimeFormat('en-NG', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(value);
  }
  private participant(userId: string, id?: string) {
    return {
      ...(id ? { id } : {}),
      OR: [{ buyerUserId: userId }, { vendorProfile: { userId } }],
    };
  }
  private async requireParticipant(userId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: this.participant(userId, id),
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return conversation;
  }

  async assertParticipant(userId: string, id: string) {
    await this.requireParticipant(userId, id);
  }

  private pruneTyping(conversationId?: string) {
    const now = Date.now();
    const pruneOne = (id: string, users: Map<string, number>) => {
      for (const [userId, expiresAt] of users.entries()) {
        if (expiresAt <= now) users.delete(userId);
      }
      if (!users.size) this.typingByConversation.delete(id);
    };

    if (conversationId) {
      const users = this.typingByConversation.get(conversationId);
      if (users) pruneOne(conversationId, users);
      return;
    }

    for (const [id, users] of this.typingByConversation.entries()) {
      pruneOne(id, users);
    }
  }

  private setTypingState(
    userId: string,
    conversationId: string,
    typing: boolean,
  ) {
    this.pruneTyping(conversationId);
    if (!typing) {
      const users = this.typingByConversation.get(conversationId);
      if (!users) return;
      users.delete(userId);
      if (!users.size) this.typingByConversation.delete(conversationId);
      return;
    }

    const users =
      this.typingByConversation.get(conversationId) ??
      new Map<string, number>();
    users.set(userId, Date.now() + this.typingWindowMs);
    this.typingByConversation.set(conversationId, users);
  }

  private isOtherParticipantTyping(userId: string, conversationId: string) {
    this.pruneTyping(conversationId);
    const users = this.typingByConversation.get(conversationId);
    if (!users?.size) return false;
    for (const participantId of users.keys()) {
      if (participantId !== userId) return true;
    }
    return false;
  }
  private mapMessage(
    message: Prisma.ChatMessageGetPayload<object>,
    userId: string,
  ) {
    return {
      clientMessageId: message.clientMessageId ?? undefined,
      conversationId: message.conversationId,
      direction: message.senderUserId === userId ? 'outgoing' : 'incoming',
      id: message.id,
      invoiceId: message.invoiceId ?? undefined,
      imageUri: message.imageUri ?? undefined,
      kind: message.kind.toLowerCase(),
      sentAt: message.createdAt.toISOString(),
      text: message.text ?? undefined,
      timestampLabel: this.label(message.createdAt),
      productContext: message.productContext ?? undefined,
    };
  }
  private mapConversation(
    conversation: Conversation,
    userId: string,
    unreadCount = 0,
  ) {
    const seller = conversation.vendorProfile.userId === userId;
    const latest = conversation.messages[0];
    const otherRead = seller
      ? conversation.buyerLastReadAt
      : conversation.sellerLastReadAt;
    return {
      avatarUri:
        (seller
          ? conversation.buyer.avatarUrl
          : conversation.vendorProfile.logoUrl) ?? undefined,
      favorite: conversation.favorite,
      id: conversation.id,
      status: conversation.status.toLowerCase(),
      subject: conversation.subject ?? undefined,
      productId: conversation.productId ?? undefined,
      productName: conversation.productName ?? undefined,
      canManageStatus: seller,
      name: seller
        ? [conversation.buyer.firstName, conversation.buyer.lastName]
            .filter(Boolean)
            .join(' ') || 'Buyer'
        : conversation.vendorProfile.storeName,
      preview:
        latest?.text ??
        (latest?.kind === 'IMAGE'
          ? 'Photo'
          : latest?.kind === 'VOICE'
            ? 'Voice message'
            : 'Start a conversation'),
      previewRead: !!(
        latest &&
        latest.senderUserId === userId &&
        otherRead &&
        otherRead >= latest.createdAt
      ),
      timestampLabel: this.label(latest?.createdAt ?? conversation.updatedAt),
      typing: this.isOtherParticipantTyping(userId, conversation.id),
      unreadCount,
      vendorId: conversation.vendorProfile.userId,
      buyerId: conversation.buyerUserId,
      updatedAt: conversation.updatedAt.toISOString(),
      verified:
        !seller && conversation.vendorProfile.reviewStatus === 'APPROVED',
    };
  }
  async list(userId: string, sellerOnly = false) {
    this.pruneTyping();
    const conversations = await this.prisma.conversation.findMany({
      where: sellerOnly
        ? { vendorProfile: { userId } }
        : this.participant(userId),
      include: conversationInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    // Reserved order threads only expose an order link after checking both participants.
    const orderIds = conversations.flatMap((conversation) => {
      const match = conversation.clientThreadId?.match(
        /^order:([0-9a-f-]{36}):/i,
      );
      return match ? [match[1]] : [];
    });
    const orders = orderIds.length
      ? await this.prisma.commerceOrder.findMany({
          where: {
            id: { in: orderIds },
            OR: [{ userId }, { items: { some: { vendorId: userId } } }],
          },
          select: {
            id: true,
            userId: true,
            items: { select: { vendorId: true } },
          },
        })
      : [];
    return {
      conversations: await Promise.all(
        conversations.map(async (conversation) => {
          const lastRead =
            conversation.buyerUserId === userId
              ? conversation.buyerLastReadAt
              : conversation.sellerLastReadAt;
          const unread = await this.prisma.chatMessage.count({
            where: {
              conversationId: conversation.id,
              senderUserId: { not: userId },
              ...(lastRead ? { createdAt: { gt: lastRead } } : {}),
            },
          });
          const order = orders.find(
            (order) =>
              conversation.clientThreadId ===
                `order:${order.id}:${conversation.vendorProfileId}` &&
              conversation.buyerUserId === order.userId &&
              order.items.some(
                (item) => item.vendorId === conversation.vendorProfile.userId,
              ),
          );
          return {
            ...this.mapConversation(conversation, userId, unread),
            ...(order ? { orderId: order.id } : {}),
          };
        }),
      ),
      messagesByConversation: {},
    };
  }
  async productContext(vendorProfileId: string, dto: ProductContextDto) {
    if (!dto.productId) {
      if (dto.quantity !== undefined || dto.selectedVariants !== undefined)
        throw new BadRequestException('Select a product for this context.');
      return undefined;
    }
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, vendorProfileId, status: 'ACTIVE' },
    });
    if (!product)
      throw new NotFoundException('Product not found in this store.');
    const quantity = dto.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException(
        'Choose at least one item before sending this product in chat.',
      );
    }
    if (product.quantity <= 0) {
      throw new BadRequestException('This product is out of stock right now.');
    }
    if (quantity > product.quantity) {
      throw new BadRequestException(
        `Only ${product.quantity} item${product.quantity === 1 ? '' : 's'} available right now.`,
      );
    }
    const selectedVariants = dto.selectedVariants ?? {};
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const selectableKeys = ['color', 'size', 'variant'];
    for (const [key, value] of Object.entries(selectedVariants)) {
      if (
        !selectableKeys.includes(key) ||
        key.length > 80 ||
        typeof value !== 'string' ||
        !value ||
        value.length > 80
      )
        throw new BadRequestException('Invalid product variant.');
    }
    const variantObjects = variants.filter(
      (entry): entry is Prisma.JsonObject =>
        Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)),
    );
    const requiredKeys = selectableKeys.filter((key) =>
      variantObjects.some(
        (entry) => typeof entry[key === 'variant' ? 'type' : key] === 'string',
      ),
    );
    if (requiredKeys.some((key) => !selectedVariants[key])) {
      throw new BadRequestException('Choose all product options first.');
    }
    const selectedCombination = variantObjects.find((entry) =>
      requiredKeys.every(
        (key) =>
          entry[key === 'variant' ? 'type' : key] === selectedVariants[key],
      ),
    );
    if (requiredKeys.length && !selectedCombination) {
      throw new BadRequestException(
        'The selected product variant is not available.',
      );
    }
    if (selectedCombination) {
      const variantQuantity = selectedCombination.quantity;
      if (typeof variantQuantity !== 'number' || variantQuantity <= 0) {
        throw new BadRequestException(
          'That variant is out of stock right now.',
        );
      }
      if (variantQuantity < quantity) {
        throw new BadRequestException(
          `Only ${variantQuantity} item${variantQuantity === 1 ? '' : 's'} available for this variant.`,
        );
      }
    }
    const now = new Date();
    const unitPrice =
      product.promoPrice &&
      product.promoStartsAt &&
      product.promoEndsAt &&
      product.promoStartsAt <= now &&
      product.promoEndsAt > now
        ? product.promoPrice
        : product.unitPrice;
    return {
      productId: product.id,
      name: product.name,
      imageUri: product.imageUrls[0] ?? '',
      unitPrice,
      quantity,
      selectedVariants,
    };
  }
  async start(
    userId: string,
    vendorId: string,
    dto: StartConversationDto = { vendorId },
  ) {
    const vendor = await this.prisma.vendorProfile.findFirst({
      where: { setupCompleted: true, userId: vendorId },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Seller not found.');
    if (vendorId === userId)
      throw new BadRequestException('You cannot message your own store.');
    const context = await this.productContext(vendor.id, dto);
    let record: Conversation;
    if (dto.conversationId) {
      const existing = await this.prisma.conversation.findFirst({
        where: {
          id: dto.conversationId,
          buyerUserId: userId,
          vendorProfileId: vendor.id,
        },
        include: conversationInclude,
      });
      if (!existing) throw new NotFoundException('Conversation not found.');
      record = existing;
    } else if (dto.newThread) {
      const clientThreadId = dto.clientThreadId || randomUUID();
      if (clientThreadId.startsWith('order:'))
        throw new BadRequestException(
          'Order conversations must be opened from an order.',
        );
      record = await this.prisma.conversation.upsert({
        where: { clientThreadId },
        create: {
          buyerUserId: userId,
          clientThreadId,
          subject: context?.name ?? 'Store enquiry',
          productId: context?.productId,
          productName: context?.name,
          vendorProfileId: vendor.id,
        },
        update: {},
        include: conversationInclude,
      });
      if (
        record.buyerUserId !== userId ||
        record.vendorProfileId !== vendor.id
      ) {
        throw new BadRequestException('Invalid conversation request.');
      }
    } else {
      record =
        (await this.prisma.conversation.findFirst({
          where: {
            buyerUserId: userId,
            vendorProfileId: vendor.id,
            status: { in: ['OPEN', 'PENDING'] },
            productId: context?.productId ?? null,
          },
          include: conversationInclude,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        })) ??
        (await this.prisma.conversation.create({
          data: {
            buyerUserId: userId,
            subject: context?.name ?? 'Store enquiry',
            productId: context?.productId,
            productName: context?.name,
            vendorProfileId: vendor.id,
          },
          include: conversationInclude,
        }));
    }
    const conversation = context
      ? await this.prisma.$transaction(async (tx) => {
          const latest = record.messages[0];
          const existing = dto.clientMessageId
            ? await tx.chatMessage.findUnique({
                where: {
                  conversationId_clientMessageId: {
                    clientMessageId: dto.clientMessageId,
                    conversationId: record.id,
                  },
                },
              })
            : latest && this.sameProductContext(latest.productContext, context)
              ? latest
              : null;
          if (existing) return record;
          const created = await tx.chatMessage.create({
            data: {
              clientMessageId: dto.clientMessageId,
              conversationId: record.id,
              senderUserId: userId,
              kind: 'TEXT',
              text: `I'm interested in ${context.name}.`,
              productContext: context,
            },
          });
          return tx.conversation.update({
            where: { id: record.id },
            data: { updatedAt: created.createdAt },
            include: conversationInclude,
          });
        })
      : record;
    return this.mapConversation(conversation, userId);
  }

  async updateStatus(
    userId: string,
    conversationId: string,
    status: ConversationStatusValue,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, vendorProfile: { userId } },
      include: conversationInclude,
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status },
      include: conversationInclude,
    });
    return this.mapConversation(updated, userId);
  }
  async messages(userId: string, conversationId: string) {
    await this.requireParticipant(userId, conversationId);
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const displayedInvoices = new Set<string>();
    const announcements = new Set<string>();
    return messages.flatMap((message) => {
      const mapped = this.mapMessage(message, userId);
      if (message.invoiceId) {
        const announcement = JSON.stringify([message.invoiceId, message.text]);
        if (announcements.has(announcement)) return [];
        announcements.add(announcement);
        if (displayedInvoices.has(message.invoiceId))
          mapped.invoiceId = undefined;
        displayedInvoices.add(message.invoiceId);
      }
      return [mapped];
    });
  }
  async read(userId: string, id: string) {
    const conversation = await this.requireParticipant(userId, id);
    await this.prisma.conversation.update({
      where: { id },
      data: {
        ...(conversation.buyerUserId === userId
          ? { buyerLastReadAt: new Date() }
          : { sellerLastReadAt: new Date() }),
        updatedAt: conversation.updatedAt,
      },
    });
    return { id };
  }
  async send(userId: string, conversationId: string, dto: SendMessageDto) {
    const conversation = await this.requireParticipant(userId, conversationId);
    if (dto.clientMessageId) {
      const existing = await this.prisma.chatMessage.findUnique({
        where: {
          conversationId_clientMessageId: {
            clientMessageId: dto.clientMessageId,
            conversationId,
          },
        },
      });
      if (existing) return this.mapMessage(existing, userId);
    }
    const productContext = await this.productContext(
      conversation.vendorProfileId,
      dto,
    );
    if (dto.kind === MessageKind.TEXT && !dto.text?.trim() && !productContext)
      throw new BadRequestException('Enter a message.');
    if (dto.kind !== MessageKind.TEXT && !dto.imageUri)
      throw new BadRequestException('Attach the message file.');
    if (
      dto.imageUri &&
      !/^https:\/\//.test(dto.imageUri) &&
      !/^\/uploads\/[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(dto.imageUri)
    )
      throw new BadRequestException('Upload the attachment before sending it.');
    let message: Prisma.ChatMessageGetPayload<object>;
    try {
      message = await this.prisma.$transaction(async (tx) => {
        const created = await tx.chatMessage.create({
          data: {
            clientMessageId: dto.clientMessageId,
            conversationId,
            imageUri: dto.imageUri,
            kind: dto.kind.toUpperCase() as 'TEXT' | 'IMAGE' | 'VOICE',
            senderUserId: userId,
            text:
              dto.text?.trim() ||
              (productContext
                ? `I'm interested in ${productContext.name}.`
                : undefined),
            productContext,
          },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { updatedAt: created.createdAt },
        });
        return created;
      });
    } catch (error) {
      if (!dto.clientMessageId || !this.isUniqueConstraintError(error))
        throw error;
      const existing = await this.prisma.chatMessage.findUnique({
        where: {
          conversationId_clientMessageId: {
            clientMessageId: dto.clientMessageId,
            conversationId,
          },
        },
      });
      if (!existing) throw error;
      message = existing;
    }
    this.setTypingState(userId, conversationId, false);
    return this.mapMessage(message, userId);
  }

  private sameProductContext(
    value: Prisma.JsonValue | null,
    context: Awaited<ReturnType<MessagingService['productContext']>>,
  ) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !context)
      return false;
    return (
      value.productId === context.productId &&
      value.quantity === context.quantity &&
      JSON.stringify(value.selectedVariants ?? {}) ===
        JSON.stringify(context.selectedVariants ?? {})
    );
  }

  private isUniqueConstraintError(error: unknown) {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P2002',
    );
  }

  async typing(userId: string, conversationId: string, typing: boolean) {
    await this.requireParticipant(userId, conversationId);
    this.setTypingState(userId, conversationId, typing);
    return { conversationId, typing };
  }
}
