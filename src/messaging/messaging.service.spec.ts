jest.mock('prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { MessagingService } from './messaging.service';

describe('MessagingService', () => {
  const prisma = {
    conversation: {
      upsert: jest.fn(),
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
});
