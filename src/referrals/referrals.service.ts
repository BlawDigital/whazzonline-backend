import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class ReferralsService {
  constructor(private readonly prisma: PrismaService) {}

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
      referrals,
    };
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
