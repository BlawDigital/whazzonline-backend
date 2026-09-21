import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

  private mapReferral(referral: {
    id: string;
    createdAt: Date;
    completedAt: Date | null;
    refereeName: string;
    rewardAmount: number;
    status: 'COMPLETED' | 'PENDING';
  }) {
    const complete = referral.status === 'COMPLETED';
    const completed = (id: string, label: string, at = referral.createdAt) => ({
      id, label, state: 'complete', timestamp: at.toISOString(), description: null,
    });
    return {
      ...referral,
      createdAt: referral.createdAt.toISOString(),
      completedAt: referral.completedAt?.toISOString() ?? null,
      vendor: { name: referral.refereeName, avatarUrl: null, phone: null },
      progress: complete
        ? [
            completed('activated', 'Referral Activated'),
            completed('joined', 'Joined Whazzonline'),
            completed('first-month', 'First Month (Free)'),
            completed('first-3-payments', 'First 3 Payment'),
            completed('reward', 'Reward Credited', referral.completedAt ?? referral.createdAt),
            completed('recurring', 'Recurring Rewards', referral.completedAt ?? referral.createdAt),
          ]
        : [
            completed('activated', 'Referral Activated'),
            completed('joined', 'Joined Whazzonline'),
            completed('first-month', 'First Month (Free)'),
            { id: 'first-3-payments', label: 'First 3 Payment', state: 'current', timestamp: null, description: 'In progress...' },
            { id: 'reward', label: 'Reward Credited', state: 'pending', timestamp: null, description: 'Pending...' },
            { id: 'recurring', label: 'Recurring Rewards', state: 'pending', timestamp: null, description: 'Pending...' },
          ],
    };
  }

  async overview(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    const [referrals, wallet] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerUserId: userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.wallet.findUnique({ where: { userId } }),
    ]);
    const successful = referrals.filter((item) => item.status === 'COMPLETED');
    return {
      referralLink: `whazzonline.com/ref/${userId.slice(0, 8)}`,
      summary: {
        pending: referrals.filter((item) => item.status === 'PENDING').length,
        successful: successful.length,
        total: referrals.length,
        totalRewards: successful.reduce(
          (sum, item) => sum + item.rewardAmount,
          0,
        ),
      },
      walletReferralBonus: wallet?.referralBonus ?? 0,
      referrals: referrals.map((referral) => this.mapReferral(referral)),
    };
  }

  async detail(userId: string, referralId: string) {
    const referral = await this.prisma.referral.findFirst({
      where: { id: referralId, referrerUserId: userId },
    });
    if (!referral) throw new NotFoundException('Referral not found.');
    return this.mapReferral(referral);
  }

  async rewardHistory(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return [];
    return this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id, type: 'REFERRAL_BONUS' },
      orderBy: { createdAt: 'desc' },
    });
  }
}
