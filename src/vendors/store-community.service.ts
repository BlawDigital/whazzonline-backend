import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { StoreCommunityQueryDto } from './dto/store-community.dto';

const reviewer = {
  avatarUrl: true,
  city: true,
  state: true,
  firstName: true,
  lastName: true,
} as const;
function person(user: {
  avatarUrl: string | null;
  city: string | null;
  state: string | null;
  firstName: string | null;
  lastName: string | null;
}) {
  return {
    avatarUrl: user.avatarUrl,
    location: [user.city, user.state].filter(Boolean).join(', '),
    reviewerName:
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      'Verified buyer',
  };
}

@Injectable()
export class StoreCommunityService {
  constructor(private readonly prisma: PrismaService) {}

  async reviews(
    userId: string,
    query: StoreCommunityQueryDto,
    viewerId: string,
  ) {
    const where = {
      vendorProfile: { userId },
      ...(query.search
        ? {
            OR: [
              {
                reason: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                reviewer: {
                  firstName: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
              {
                reviewer: {
                  lastName: {
                    contains: query.search,
                    mode: 'insensitive' as const,
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, reviews] = await Promise.all([
      this.prisma.vendorTrustReview.count({ where }),
      this.prisma.vendorTrustReview.findMany({
        where,
        skip: query.offset,
        take: query.limit,
        orderBy:
          query.sort === 'highest' || query.sort === 'lowest'
            ? [
                {
                  rating: {
                    sort: query.sort === 'highest' ? 'desc' : 'asc',
                    nulls: 'last',
                  },
                },
                { createdAt: 'desc' },
                { id: 'desc' },
              ]
            : [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          reviewer: { select: reviewer },
          votes: { select: { userId: true, helpful: true } },
        },
      }),
    ]);
    return {
      total,
      reviews: reviews.map((review) => ({
        ...person(review.reviewer),
        id: review.id,
        reason: review.reason,
        rating: review.rating,
        createdAt: review.createdAt.toISOString(),
        helpfulCount: review.votes.filter((vote) => vote.helpful).length,
        notHelpfulCount: review.votes.filter((vote) => !vote.helpful).length,
        viewerVote:
          review.votes.find((vote) => vote.userId === viewerId)?.helpful ??
          null,
      })),
    };
  }

  async trustees(userId: string, query: StoreCommunityQueryDto) {
    const where = { vendorProfile: { userId } };
    // One trustee per buyer, even when that buyer reviewed several orders.
    const trustees = await this.prisma.vendorTrustReview.findMany({
      where,
      distinct: ['reviewerUserId'],
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { reviewerUserId: true, reviewer: { select: reviewer } },
    });
    return {
      total: trustees.length,
      trustees: trustees
        .slice(query.offset, query.offset + query.limit)
        .map((review) => ({
          id: review.reviewerUserId,
          ...person(review.reviewer),
          role: 'Buyer',
        })),
    };
  }

  async vote(
    userId: string,
    reviewId: string,
    voterId: string,
    helpful?: boolean | null,
  ) {
    const review = await this.prisma.vendorTrustReview.findFirst({
      where: { id: reviewId, vendorProfile: { userId } },
      select: { id: true },
    });
    if (!review) throw new NotFoundException('Review not found.');
    if (helpful === null || helpful === undefined) {
      await this.prisma.vendorReviewVote.deleteMany({
        where: { userId: voterId, reviewId },
      });
    } else {
      await this.prisma.vendorReviewVote.upsert({
        where: { userId_reviewId: { userId: voterId, reviewId } },
        create: { userId: voterId, reviewId, helpful },
        update: { helpful },
      });
    }
    return { reviewId, helpful: helpful ?? null };
  }
}
