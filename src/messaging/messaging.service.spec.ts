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
      findMany: jest.fn(),
    },
    conversation: {
      create: jest.fn(),
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
  it('shows one card per invoice while retaining status updates and removing duplicate legacy announcements', async () => {
    prisma.conversation.findFirst.mockResolvedValue({ id: 'thread' });
    const base = {
      createdAt: new Date(),
      conversationId: 'thread',
      senderUserId: 'vendor',
      kind: 'TEXT',
      invoiceId: 'invoice-one',
      imageUri: null,
      clientMessageId: null,
      productContext: null,
    };
    prisma.chatMessage.findMany.mockResolvedValue([
      { ...base, id: 'one', text: 'Invoice INV-1: pay the merchant.' },
      { ...base, id: 'duplicate', text: 'Invoice INV-1: pay the merchant.' },
      { ...base, id: 'status', text: 'Invoice INV-1: Payment confirmed.' },
      {
        ...base,
        id: 'two',
        invoiceId: 'invoice-two',
        text: 'Invoice INV-2: pay the merchant.',
      },
    ]);
    const result = await service.messages('buyer', 'thread');
    expect(result.map((message) => message.id)).toEqual([
      'one',
      'status',
      'two',
    ]);
    expect(result.filter((message) => message.invoiceId)).toHaveLength(2);
    expect(result[1]).toMatchObject({
      text: 'Invoice INV-1: Payment confirmed.',
      invoiceId: undefined,
    });
  });

  it('opens one persisted conversation for a real marketplace vendor', async () => {
    prisma.vendorProfile.findFirst.mockResolvedValue({
      id: 'vendor-profile-id',
    });
    prisma.conversation.findFirst.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({
      buyer: { avatarUrl: null, firstName: 'Buyer', lastName: null },
      buyerLastReadAt: null,
      favorite: false,
      id: 'conversation-id',
      messages: [],
      sellerLastReadAt: null,
      status: 'OPEN',
      subject: 'Store enquiry',
      updatedAt: new Date('2026-09-15T10:00:00.000Z'),
      vendorProfile: {
        logoUrl: 'https://example.com/vendor.png',
        reviewStatus: 'APPROVED',
        storeName: 'Oden Store',
        userId: 'vendor-user-id',
      },
    });

    const result = await service.start('buyer-user-id', 'vendor-user-id');

    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          buyerUserId: 'buyer-user-id',
          subject: 'Store enquiry',
          vendorProfileId: 'vendor-profile-id',
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
      buyerUserId: 'buyer-user-id',
      buyerLastReadAt: null,
      favorite: false,
      id: 'conversation-id',
      messages: [],
      sellerLastReadAt: null,
      status: 'OPEN',
      subject: 'Running shoes',
      updatedAt: createdAt,
      vendorProfile: {
        logoUrl: null,
        reviewStatus: 'APPROVED',
        storeName: 'Shoe Store',
        userId: 'vendor-user-id',
      },
      vendorProfileId: 'vendor-profile-id',
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
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) =>
        await callback(tx),
    );
    prisma.vendorProfile.findFirst.mockResolvedValue({
      id: 'vendor-profile-id',
    });
    prisma.conversation.upsert.mockResolvedValue(conversation);
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
      clientThreadId: 'client-thread-id',
      newThread: true,
      productId: 'product-id',
      vendorId: 'vendor-user-id',
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
