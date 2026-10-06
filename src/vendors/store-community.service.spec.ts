jest.mock('prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));
import { NotFoundException } from '@nestjs/common';
import { StoreCommunityService } from './store-community.service';
import { StoreCommunityQueryDto } from './dto/store-community.dto';
describe('Store community', () => {
  const prisma = {
    vendorTrustReview: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    vendorReviewVote: { upsert: jest.fn(), deleteMany: jest.fn() },
  };
  const service = new StoreCommunityService(prisma as never);
  beforeEach(() => jest.clearAllMocks());
  it('returns real ratings, counts and the signed-in buyer vote without leaking voter IDs', async () => {
    prisma.vendorTrustReview.count.mockResolvedValue(1);
    prisma.vendorTrustReview.findMany.mockResolvedValue([
      {
        id: 'review',
        createdAt: new Date('2026-10-01'),
        reason: 'Great delivery',
        rating: 4,
        reviewer: {
          avatarUrl: null,
          firstName: 'Ada',
          lastName: 'Okon',
          city: 'Yaba',
          state: 'Lagos',
        },
        votes: [
          { userId: 'viewer', helpful: true },
          { userId: 'other', helpful: false },
        ],
      },
    ]);
    const result = await service.reviews(
      'seller',
      Object.assign(new StoreCommunityQueryDto(), {
        sort: 'highest',
        search: 'delivery',
        offset: 10,
      }),
      'viewer',
    );
    expect(result).toEqual({
      total: 1,
      reviews: [
        expect.objectContaining({
          reviewerName: 'Ada Okon',
          rating: 4,
          helpfulCount: 1,
          notHelpfulCount: 1,
          viewerVote: true,
        }),
      ],
    });
    expect(prisma.vendorTrustReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        orderBy: [
          { rating: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
      }),
    );
    expect(JSON.stringify(result)).not.toContain('userId');
  });
  it('counts distinct trustees before paging', async () => {
    prisma.vendorTrustReview.findMany.mockResolvedValue([
      {
        reviewerUserId: 'buyer',
        reviewer: {
          firstName: 'Ada',
          lastName: null,
          city: null,
          state: null,
          avatarUrl: null,
        },
      },
    ]);
    expect(
      await service.trustees('seller', new StoreCommunityQueryDto()),
    ).toMatchObject({ total: 1, trustees: [{ id: 'buyer', role: 'Buyer' }] });
    expect(prisma.vendorTrustReview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ['reviewerUserId'] }),
    );
  });
  it('upserts one vote per user and allows clearing it', async () => {
    prisma.vendorTrustReview.findFirst.mockResolvedValue({ id: 'review' });
    await service.vote('seller', 'review', 'buyer', false);
    expect(prisma.vendorReviewVote.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_reviewId: { userId: 'buyer', reviewId: 'review' } },
        update: { helpful: false },
      }),
    );
    await service.vote('seller', 'review', 'buyer', null);
    expect(prisma.vendorReviewVote.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'buyer', reviewId: 'review' },
    });
  });
  it('blocks voting on a review belonging to a different store', async () => {
    prisma.vendorTrustReview.findFirst.mockResolvedValue(null);
    await expect(
      service.vote('wrong-seller', 'review', 'buyer', true),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.vendorReviewVote.upsert).not.toHaveBeenCalled();
  });
});
