import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from 'prisma/prisma.service';
import { MessageKind, SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class MessagingService {
  constructor(private readonly prisma: PrismaService) {}

  private label(value: Date) {
    return new Intl.DateTimeFormat('en-NG', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(value);
  }

  private mapMessage(
    message: {
      conversationId: string;
      createdAt: Date;
      id: string;
      imageUri: string | null;
      kind: 'TEXT' | 'IMAGE' | 'VOICE';
      senderUserId: string;
      text: string | null;
    },
    userId: string,
  ) {
    return {
      conversationId: message.conversationId,
      direction: message.senderUserId === userId ? 'outgoing' : 'incoming',
      id: message.id,
      imageUri: message.imageUri ?? undefined,
      kind: message.kind.toLowerCase(),
      sentAt: message.createdAt.toISOString(),
      text: message.text ?? undefined,
      timestampLabel: this.label(message.createdAt),
    };
  }

  private mapConversation(
    conversation: {
      favorite: boolean;
      id: string;
      messages: Array<{
        createdAt: Date;
        kind: 'TEXT' | 'IMAGE' | 'VOICE';
        senderUserId: string;
        text: string | null;
      }>;
      updatedAt: Date;
      vendorProfile: {
        logoUrl: string | null;
        reviewStatus: string;
        storeName: string;
        userId: string;
      };
    },
    userId: string,
  ) {
    const latest = conversation.messages[0];
    return {
      avatarUri: conversation.vendorProfile.logoUrl ?? undefined,
      favorite: conversation.favorite,
      id: conversation.id,
      name: conversation.vendorProfile.storeName,
      preview:
        latest?.text ??
        (latest?.kind === 'IMAGE'
          ? 'Photo'
          : latest?.kind === 'VOICE'
            ? 'Voice message'
            : 'Start a conversation'),
      previewRead: latest?.senderUserId === userId,
      timestampLabel: this.label(latest?.createdAt ?? conversation.updatedAt),
      unreadCount: 0,
      vendorId: conversation.vendorProfile.userId,
      verified: conversation.vendorProfile.reviewStatus === 'APPROVED',
    };
  }

  async list(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { buyerUserId: userId },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        vendorProfile: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      conversations: conversations.map((conversation) =>
        this.mapConversation(conversation, userId),
      ),
      messagesByConversation: {},
    };
  }

  async start(userId: string, vendorId: string) {
    const vendorProfile = await this.prisma.vendorProfile.findFirst({
      where: { setupCompleted: true, userId: vendorId },
      select: { id: true },
    });
    if (!vendorProfile) throw new NotFoundException('Seller not found.');
    if (vendorId === userId) {
      throw new BadRequestException('You cannot message your own store.');
    }

    const conversation = await this.prisma.conversation.upsert({
      where: {
        buyerUserId_vendorProfileId: {
          buyerUserId: userId,
          vendorProfileId: vendorProfile.id,
        },
      },
      create: {
        buyerUserId: userId,
        vendorProfileId: vendorProfile.id,
      },
      update: {},
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        vendorProfile: true,
      },
    });
    return this.mapConversation(conversation, userId);
  }

  async messages(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, buyerUserId: userId },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map((message) => this.mapMessage(message, userId));
  }

  async send(userId: string, conversationId: string, dto: SendMessageDto) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, buyerUserId: userId },
      select: { id: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    if (dto.kind === MessageKind.TEXT && !dto.text?.trim()) {
      throw new BadRequestException('Enter a message.');
    }
    if (dto.kind !== MessageKind.TEXT && !dto.imageUri) {
      throw new BadRequestException('Attach the message file.');
    }
    const message = await this.prisma.chatMessage.create({
      data: {
        conversationId,
        imageUri: dto.imageUri,
        kind: dto.kind.toUpperCase() as 'TEXT' | 'IMAGE' | 'VOICE',
        senderUserId: userId,
        text: dto.text?.trim(),
      },
    });
    return this.mapMessage(message, userId);
  }
}
