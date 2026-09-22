import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { MessageKind, SendMessageDto } from './dto/send-message.dto';
import { ProductContextDto } from './dto/product-context.dto';

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
          return this.mapConversation(conversation, userId, unread);
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
    for (const [key, value] of Object.entries(selectedVariants)) {
      if (
        !key ||
        key.length > 80 ||
        typeof value !== 'string' ||
        !value ||
        value.length > 80
      )
        throw new BadRequestException('Invalid product variant.');
      const match = variants.find(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          entry.type === value,
      );
      if (
        !match ||
        typeof match !== 'object' ||
        Array.isArray(match) ||
        typeof match.quantity !== 'number'
      ) {
        throw new BadRequestException(
          'The selected product variant is not available.',
        );
      }
      if (match.quantity <= 0) {
        throw new BadRequestException(
          'That variant is out of stock right now.',
        );
      }
      if (match.quantity < quantity) {
        throw new BadRequestException(
          `Only ${match.quantity} item${match.quantity === 1 ? '' : 's'} available for this variant.`,
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
  async start(userId: string, vendorId: string, dto: ProductContextDto = {}) {
    const vendor = await this.prisma.vendorProfile.findFirst({
      where: { setupCompleted: true, userId: vendorId },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Seller not found.');
    if (vendorId === userId)
      throw new BadRequestException('You cannot message your own store.');
    const context = await this.productContext(vendor.id, dto);
    const args = {
      where: {
        buyerUserId_vendorProfileId: {
          buyerUserId: userId,
          vendorProfileId: vendor.id,
        },
      },
      create: { buyerUserId: userId, vendorProfileId: vendor.id },
      update: {},
      include: conversationInclude,
    };
    const conversation = context
      ? await this.prisma.$transaction(async (tx) => {
          const record = await tx.conversation.upsert(args);
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
      : await this.prisma.conversation.upsert(args);
    return this.mapConversation(conversation, userId);
  }
  async messages(userId: string, conversationId: string) {
    await this.requireParticipant(userId, conversationId);
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return messages.map((message) => this.mapMessage(message, userId));
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
