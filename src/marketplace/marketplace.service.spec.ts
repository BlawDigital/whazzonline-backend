jest.mock('prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { MarketplaceService } from './marketplace.service';

describe('MarketplaceService', () => {
  it('derives public trust count and reasons from persisted reviews', async () => {
    const prisma = {
      product: { findMany: jest.fn().mockResolvedValue([]) },
      vendorProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            _count: { trustReviews: 1 },
            bannerUrl: null,
            category: 'Fashion',
            city: 'Ikeja',
            description: 'A verified fashion seller.',
            logoUrl: null,
            state: 'Lagos',
            storeName: 'Example Store',
            trustReviews: [
              {
                createdAt: new Date('2026-09-09T12:00:00.000Z'),
                id: 'review-id',
                reason: 'The item arrived exactly as described.',
                reviewer: {
                  avatarUrl: null,
                  city: 'Ikeja',
                  firstName: 'Ada',
                  lastName: 'Okafor',
                  state: 'Lagos',
                },
              },
            ],
            userId: 'vendor-id',
          },
        ]),
      },
    };
    const service = new MarketplaceService(prisma as never);

    const result = await service.list();

    expect(result.vendors[0]).toMatchObject({
      id: 'vendor-id',
      trustReviewCount: 1,
      trustReviews: [
        {
          reason: 'The item arrived exactly as described.',
          reviewerName: 'Ada O.',
        },
      ],
    });
  });
});
