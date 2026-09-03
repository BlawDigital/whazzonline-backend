import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  private async getWallet(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    return this.prisma.wallet.upsert({
      where: { userId },
      create: {
        accountName:
          [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          'Whazzonline User',
        accountNumber: `019${userId.replace(/-/g, '').slice(0, 7)}`,
        availableBalance: 0,
        bankName: 'Paystack - Titan',
        mainBalance: 0,
        referralBonus: 0,
        userId,
      },
      update: {},
    });
  }

  async summary(userId: string) {
    const wallet = await this.getWallet(userId);
    return {
      accountName: wallet.accountName,
      accountNumber: wallet.accountNumber,
      availableBalance: wallet.availableBalance,
      bankName: wallet.bankName,
      mainBalance: wallet.mainBalance,
      referralBonus: wallet.referralBonus,
    };
  }

  async transactions(userId: string) {
    const wallet = await this.getWallet(userId);
    return this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
    });
  }
}
