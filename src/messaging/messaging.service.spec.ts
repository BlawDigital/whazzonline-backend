jest.mock('prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { MessagingService } from './messaging.service';
import { MessageKind } from './dto/send-message.dto';

describe('MessagingService', () => {
  const prisma = {
    $transaction: jest.fn(),
    chatMessage: {
      findUnique: jest.fn(),
    },
    conversation: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
    },
    vendorProfile: {
      findFirst: jest.fn(),
    },
  };
  const service = new MessagingService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('opens one persisted conversation for a real marketplace vendor', async () => {
    prisma.vendorProfile.findFirst.mockResolvedValue({
      id: 'vendor-profile-id',
    });
    prisma.conversation.upsert.mockResolvedValue({
      favorite: false,
      id: 'conversation-id',
      messages: [],
      updatedAt: new Date('2026-09-15T10:00:00.000Z'),
      vendorProfile: {
        logoUrl: 'https://example.com/vendor.png',
        reviewStatus: 'APPROVED',
        storeName: 'Oden Store',
        userId: 'vendor-user-id',
      },
    });

    const result = await service.start('buyer-user-id', 'vendor-user-id');

    expect(prisma.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          buyerUserId: 'buyer-user-id',
          vendorProfileId: 'vendor-profile-id',
        },
        where: {
          buyerUserId_vendorProfileId: {
            buyerUserId: 'buyer-user-id',
            vendorProfileId: 'vendor-profile-id',
          },
        },
      }),
    );
    expect(result).toMatchObject({
      id: 'conversation-id',
      vendorId: 'vendor-user-id',
      name: 'Oden Store',
    });
  });

  it('rejects a buyer conversation with the same user store', async () => {
    prisma.vendorProfile.findFirst.mockResolvedValue({
      id: 'vendor-profile-id',
    });

    await expect(
      service.start('vendor-user-id', 'vendor-user-id'),
    ).rejects.toThrow('You cannot message your own store.');
  });

  it('does not duplicate a retried product-context message', async () => {
    const createdAt = new Date('2026-09-22T10:00:00.000Z');
    const context = {
      productId: 'product-id',
      name: 'Running shoes',
      imageUri: '/uploads/products/shoes.jpg',
      unitPrice: 25000,
      quantity: 1,
      selectedVariants: {},
    };
    const message = {
      clientMessageId: 'client-message-id',
      conversationId: 'conversation-id',
      createdAt,
      id: 'message-id',
      imageUri: null,
      kind: 'TEXT',
      productContext: context,
      senderUserId: 'buyer-user-id',
      text: "I'm interested in Running shoes.",
    };
    const conversation = {
      buyer: { avatarUrl: null, firstName: 'Buyer', lastName: null },
      buyerLastReadAt: null,
      favorite: false,
      id: 'conversation-id',
      messages: [],
      sellerLastReadAt: null,
      updatedAt: createdAt,
      vendorProfile: {
        logoUrl: null,
        reviewStatus: 'APPROVED',
        storeName: 'Shoe Store',
        userId: 'vendor-user-id',
      },
    };
    const tx = {
      chatMessage: {
        create: jest.fn().mockResolvedValue(message),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(message),
      },
      conversation: {
        update: jest
          .fn()
          .mockResolvedValue({ ...conversation, messages: [message] }),
        upsert: jest.fn().mockResolvedValue(conversation),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) =>
        await callback(tx),
    );
    prisma.vendorProfile.findFirst.mockResolvedValue({
      id: 'vendor-profile-id',
    });
    prisma.product.findFirst.mockResolvedValue({
      id: 'product-id',
      imageUrls: ['/uploads/products/shoes.jpg'],
      name: 'Running shoes',
      promoEndsAt: null,
      promoPrice: null,
      promoStartsAt: null,
      quantity: 4,
      unitPrice: 25000,
      variants: [],
    });

    const input = {
      clientMessageId: 'client-message-id',
      productId: 'product-id',
    };
    await service.start('buyer-user-id', 'vendor-user-id', input);
    await service.start('buyer-user-id', 'vendor-user-id', input);

    expect(tx.chatMessage.create).toHaveBeenCalledTimes(1);
  });

  it('returns the persisted message when a client retries the same send', async () => {
    const createdAt = new Date('2026-09-22T10:05:00.000Z');
    prisma.conversation.findFirst.mockResolvedValue({
      buyerUserId: 'buyer-user-id',
      id: 'conversation-id',
      updatedAt: createdAt,
      vendorProfileId: 'vendor-profile-id',
    });
    prisma.chatMessage.findUnique.mockResolvedValue({
      clientMessageId: 'client-message-id',
      conversationId: 'conversation-id',
      createdAt,
      id: 'message-id',
      imageUri: null,
      kind: 'TEXT',
      productContext: null,
      senderUserId: 'buyer-user-id',
      text: 'Hello',
    });

    const result = await service.send('buyer-user-id', 'conversation-id', {
      clientMessageId: 'client-message-id',
      kind: MessageKind.TEXT,
      text: 'Hello',
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      clientMessageId: 'client-message-id',
      id: 'message-id',
      text: 'Hello',
    });
  });
});
