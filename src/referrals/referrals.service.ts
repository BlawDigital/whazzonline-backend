import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from 'prisma/prisma.service';
import { Prisma } from 'generated/prisma/client';

const include = {
  referee: {
    select: {
      id: true,
      createdAt: true,
      phone: true,
      avatarUrl: true,
      vendorProfile: {
        select: {
          storeName: true,
          logoUrl: true,
          setupCompleted: true,
          submittedAt: true,
        },
      },
      merchantSubscription: {
        select: {
          trialStartedAt: true,
          payments: {
            where: { paidAt: { not: null } },
            orderBy: { paidAt: 'asc' as const },
            select: { paidAt: true },
          },
        },
      },
    },
  },
  rewards: {
    orderBy: { createdAt: 'asc' as const },
    select: { createdAt: true, amount: true },
  },
} satisfies Prisma.ReferralInclude;
type ReferralRecord = Prisma.ReferralGetPayload<{ include: typeof include }>;
export const referralRules = {
  eligibility: 'Open to all active users with a verified account.',
  steps: [
    {
      title: 'Referral Activation',
      text: 'Share your unique referral link or code with merchants.',
    },
    {
      title: 'Free First Month',
      text: 'The referred merchant gets their first month of paid subscription completely free.',
    },
    {
      title: 'First 3 Payments',
      text: 'After the free month, the merchant completes 3 standard monthly payments to Whazzonline.',
    },
    {
      title: '4th Payment Reward',
      text: 'The entire 4th payment from the merchant is credited to your wallet as a referral reward.',
    },
    {
      title: 'Recurring Rewards',
      text: 'The cycle continues! After every 12 further standard payments, the next payment is yours. Rewards repeat while the referred merchant remains active.',
    },
  ],
  terms:
    'By participating in our referral programme, you agree to our terms. We reserve the right to disqualify any participant who attempts to misuse or abuse the programme. Rewards are subject to change without prior notice. Duplicate accounts or fraudulent activity will result in disqualification and forfeiture of rewards.',
};

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}
  private mapReferral(referral: ReferralRecord) {
    const user = referral.referee,
      profile = user?.vendorProfile;
    const payments = user?.merchantSubscription?.payments ?? [];
    const credited = referral.rewards.length > 0,
      legacy = !user;
    const milestone = (
      id: string,
      label: string,
      timestamp: Date | null | undefined,
      current = false,
      description?: string,
    ) => ({
      id,
      label,
      timestamp: timestamp?.toISOString() ?? null,
      state: timestamp ? 'complete' : current ? 'current' : 'pending',
      description:
        description ??
        (timestamp ? null : current ? 'In progress...' : 'Pending...'),
    });
    const activated =
      user?.merchantSubscription?.trialStartedAt ??
      (profile?.setupCompleted ? profile.submittedAt : null);
    return {
      id: referral.id,
      refereeName: profile?.storeName ?? referral.refereeName,
      createdAt: referral.createdAt.toISOString(),
      completedAt: referral.completedAt?.toISOString() ?? null,
      status: referral.status,
      rewardAmount: referral.rewardAmount,
      legacy,
      paidPayments: payments.length,
      nextRewardPayment:
        payments.length < 4
          ? 4
          : 4 + 13 * (Math.floor((payments.length - 4) / 13) + 1),
      vendor: {
        id: user?.id ?? null,
        name: profile?.storeName ?? referral.refereeName,
        avatarUrl: profile?.logoUrl ?? user?.avatarUrl ?? null,
        phone: user?.phone ?? null,
      },
      progress: [
        milestone('activated', 'Referral Activated', referral.createdAt),
        milestone('joined', 'Joined Whazzonline', user?.createdAt, !user),
        milestone(
          'first-month',
          'First Month (Free)',
          activated,
          !!user && !activated,
        ),
        milestone(
          'first-3-payments',
          'First 3 Payments',
          payments[2]?.paidAt,
          !!activated && payments.length < 3,
          legacy
            ? 'No linked payment records.'
            : `${Math.min(payments.length, 3)} of 3 payments`,
        ),
        milestone(
          'reward',
          'Reward Credited',
          referral.rewards[0]?.createdAt ??
            (legacy ? referral.completedAt : null),
          payments.length >= 3 && !credited,
        ),
        milestone(
          'recurring',
          'Recurring Rewards',
          null,
          credited,
          credited
            ? '12 further standard payments before the next reward.'
            : undefined,
        ),
      ],
    };
  }
  async resolve(code: string) {
    const user = await this.prisma.user.findFirst({
      where: { referralCode: code, isActive: true, isVerified: true },
      select: {
        firstName: true,
        vendorProfile: { select: { storeName: true } },
      },
    });
    if (!user)
      throw new NotFoundException(
        'This referral invitation is invalid or no longer active.',
      );
    return {
      code,
      name:
        user.vendorProfile?.storeName ??
        user.firstName ??
        'A Whazzonline member',
    };
  }
  async overview(userId: string, compact = false) {
    let user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    if (!user.referralCode) {
      await this.prisma.user.updateMany({
        where: { id: userId, referralCode: null },
        data: { referralCode: randomBytes(16).toString('hex') },
      });
      user = (await this.prisma.user.findUnique({ where: { id: userId } }))!;
    }
    const where = { referrerUserId: userId };
    const [referrals, wallet, total, successful, thisWeek, last, rewards] =
      await Promise.all([
        compact
          ? Promise.resolve([])
          : this.prisma.referral.findMany({
              where,
              include,
              orderBy: { createdAt: 'desc' },
            }),
        this.prisma.wallet.findUnique({ where: { userId } }),
        this.prisma.referral.count({ where }),
        this.prisma.referral.count({
          where: { ...where, status: 'COMPLETED' },
        }),
        this.prisma.referral.count({
          where: {
            ...where,
            createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
          },
        }),
        this.prisma.referral.findFirst({
          where,
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        this.prisma.walletTransaction.aggregate({
          where: {
            wallet: { userId },
            type: 'REFERRAL_BONUS',
            status: 'COMPLETED',
          },
          _sum: { amount: true },
        }),
      ]);
    return {
      referralLink: `${(process.env.FRONTEND_URL || 'https://whazzonline.com').replace(/\/$/, '')}/ref/${user.referralCode}`,
      eligible: user.isActive && user.isVerified,
      currency: 'NGN',
      summary: {
        pending: total - successful,
        successful,
        total,
        totalRewards: rewards._sum.amount ?? 0,
        thisWeek,
        lastReferralAt: last?.createdAt.toISOString() ?? null,
      },
      walletReferralBonus: wallet?.referralBonus ?? 0,
      availableBalance: wallet?.availableBalance ?? 0,
      referrals: referrals.map((r) => this.mapReferral(r)),
    };
  }
  async list(
    userId: string,
    query: {
      page?: number;
      pageSize?: number;
      q?: string;
      status?: 'COMPLETED' | 'PENDING';
    },
  ) {
    const page = query.page ?? 1,
      pageSize = query.pageSize ?? 10;
    const where: Prisma.ReferralWhereInput = {
      referrerUserId: userId,
      status: query.status,
      ...(query.q
        ? {
            OR: [
              { refereeName: { contains: query.q, mode: 'insensitive' } },
              {
                referee: {
                  vendorProfile: {
                    storeName: { contains: query.q, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.referral.count({ where }),
    ]);
    return {
      items: items.map((r) => this.mapReferral(r)),
      total,
      page,
      pageSize,
    };
  }
  async detail(userId: string, referralId: string) {
    const referral = await this.prisma.referral.findFirst({
      where: { id: referralId, referrerUserId: userId },
      include,
    });
    if (!referral) throw new NotFoundException('Referral not found.');
    return this.mapReferral(referral);
  }
  async rewardHistory(userId: string) {
    return this.prisma.walletTransaction.findMany({
      where: {
        wallet: { userId },
        type: 'REFERRAL_BONUS',
        status: 'COMPLETED',
      },
      include: { referralReward: { select: { referralId: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  async rewards(
    userId: string,
    query: { page?: number; pageSize?: number; q?: string },
  ) {
    const page = query.page ?? 1,
      pageSize = query.pageSize ?? 10;
    const where: Prisma.WalletTransactionWhereInput = {
      wallet: { userId },
      type: 'REFERRAL_BONUS',
      status: 'COMPLETED',
      ...(query.q
        ? { description: { contains: query.q, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        include: { referralReward: { select: { referralId: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
