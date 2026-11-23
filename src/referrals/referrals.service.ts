import { Injectable, NotFoundException } from '@nestjs/common';
import { ensureReferralCode, referralCodeCandidates } from './referral-code';
import { recordReferralEvent } from './referral-events';
import { PrismaService } from 'prisma/prisma.service';
import { Prisma } from 'generated/prisma/client';

const include = {
  referee: {
    select: {
      id: true,
      createdAt: true,
      phone: true,
      avatarUrl: true,
      registrationType: true,
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
  payout: { select: { status: true, amount: true, updatedAt: true } },
} satisfies Prisma.ReferralInclude;

export const referralStatusLabels: Record<string, string> = {
  PENDING: 'Joined',
  QUALIFIED: 'Qualified',
  REWARDED: 'Reward Sent',
  COMPLETED: 'Reward Sent',
  INELIGIBLE: 'Ineligible',
  VOIDED: 'Voided',
};
type ReferralRecord = Prisma.ReferralGetPayload<{ include: typeof include }>;
export type ReferralStatusFilter =
  'COMPLETED' | 'PENDING' | 'QUALIFIED' | 'REWARDED' | 'INELIGIBLE' | 'VOIDED';
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
    const buyer = user?.registrationType === 'BUYER';
    const failed = ['INELIGIBLE', 'VOIDED'].includes(referral.status);
    const base = {
      kind: buyer ? ('BUYER' as const) : ('MERCHANT' as const),
      statusLabel: referralStatusLabels[referral.status] ?? referral.status,
      failureReason: failed ? referral.statusReason : null,
      qualifiedAt: referral.qualifiedAt?.toISOString() ?? null,
      payoutStatus: referral.payout?.status ?? null,
    };
    if (buyer) {
      const rewarded = ['REWARDED', 'COMPLETED'].includes(referral.status);
      const qualified = !!referral.qualifiedAt;
      const step = (
        id: string,
        label: string,
        timestamp: Date | null | undefined,
        current: boolean,
        description?: string | null,
      ) => ({
        ...milestone(id, label, timestamp, current, description ?? undefined),
        state:
          failed && !timestamp
            ? 'failed'
            : milestone(id, label, timestamp, current).state,
      });
      return {
        ...base,
        id: referral.id,
        refereeName: referral.refereeName,
        createdAt: referral.createdAt.toISOString(),
        completedAt: referral.completedAt?.toISOString() ?? null,
        status: referral.status,
        rewardAmount: referral.rewardAmount,
        legacy: false,
        paidPayments: 0,
        nextRewardPayment: 0,
        vendor: {
          id: user?.id ?? null,
          name: referral.refereeName,
          avatarUrl: user?.avatarUrl ?? null,
          phone: user?.phone ?? null,
        },
        progress: [
          step('joined', 'Joined Whazzonline', referral.createdAt, false),
          step(
            'qualified',
            'First Qualifying Purchase',
            referral.qualifiedAt,
            !qualified && !failed,
            qualified
              ? null
              : failed
                ? (referral.statusReason ?? 'Did not qualify.')
                : 'Waiting for a delivered order.',
          ),
          step(
            'reward',
            'Reward Sent',
            rewarded
              ? (referral.completedAt ?? referral.payout?.updatedAt)
              : null,
            qualified && !rewarded && !failed,
            rewarded
              ? null
              : qualified
                ? 'Reward is being processed.'
                : undefined,
          ),
        ],
      };
    }
    return {
      ...base,
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
      where: {
        referralCode: { in: referralCodeCandidates(code) },
        isActive: true,
        isVerified: true,
      },
      select: {
        id: true,
        referralCode: true,
        firstName: true,
        vendorProfile: { select: { storeName: true } },
      },
    });
    if (!user)
      throw new NotFoundException(
        'This referral invitation is invalid or no longer active.',
      );
    await recordReferralEvent(this.prisma, {
      referrerUserId: user.id,
      type: 'LINK_OPENED',
    });
    return {
      code: user.referralCode ?? code,
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
      // Legacy accounts get a code the first time they open the referral screen.
      await ensureReferralCode(this.prisma, userId);
      user = (await this.prisma.user.findUnique({ where: { id: userId } }))!;
    }
    const where = { referrerUserId: userId };
    const [
      referrals,
      wallet,
      total,
      successful,
      thisWeek,
      last,
      rewards,
      qualified,
      ineligible,
    ] = await Promise.all([
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
        where: { ...where, status: { in: ['COMPLETED', 'REWARDED'] } },
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
      this.prisma.referral.count({
        where: {
          ...where,
          status: { in: ['QUALIFIED', 'REWARDED', 'COMPLETED'] },
        },
      }),
      this.prisma.referral.count({
        where: { ...where, status: { in: ['INELIGIBLE', 'VOIDED'] } },
      }),
    ]);
    return {
      referralCode: user.referralCode,
      referralLink: `${(process.env.FRONTEND_URL || 'https://whazzonline.com').replace(/\/$/, '')}/ref/${user.referralCode}`,
      eligible: user.isActive && user.isVerified,
      currency: 'NGN',
      summary: {
        pending: total - successful - ineligible,
        successful,
        qualified,
        ineligible,
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
      status?: ReferralStatusFilter;
    },
  ) {
    const page = query.page ?? 1,
      pageSize = query.pageSize ?? 10;
    const where: Prisma.ReferralWhereInput = {
      referrerUserId: userId,
      status:
        query.status === 'REWARDED'
          ? { in: ['REWARDED', 'COMPLETED'] }
          : query.status,
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
  async events(userId: string) {
    return this.prisma.referralEvent.findMany({
      where: { referrerUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async notifications(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.referralNotification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.referralNotification.count({
        where: { userId, readAt: null },
      }),
    ]);
    return { items, unread };
  }
  async markNotificationsRead(userId: string) {
    await this.prisma.referralNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: true };
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
