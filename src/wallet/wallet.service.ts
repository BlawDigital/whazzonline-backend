import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { normalizePhone } from '../auth/phone/normalize-phone';
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
        availableBalance: 0,

        mainBalance: 0,
        referralBonus: 0,
        userId,
      },
      update: {},
    });
  }

  async summary(userId: string) {
    const wallet = await this.getWallet(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, phone: true },
    });
    return {
      accountName: wallet.accountName,
      accountNumber: wallet.accountNumber,
      availableBalance: wallet.availableBalance,
      bankName: wallet.bankName,
      mainBalance: wallet.mainBalance,
      referralBonus: wallet.referralBonus,
      pinConfigured: !!wallet.pinHash,
      verificationChannels: [
        ...(user.email ? ['email'] : []),
        ...(user.phone ? ['phone'] : []),
      ],
      pinLockedUntil: wallet.pinLockedUntil,
    };
  }

  async transactions(userId: string) {
    const wallet = await this.getWallet(userId);
    return this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async requestPin(userId: string, channel: 'email' | 'phone') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.isActive) throw new NotFoundException('Account not found.');
    const destination =
      channel === 'email'
        ? user.email
        : user.phone && normalizePhone(user.phone);
    if (!destination)
      throw new BadRequestException(
        `Add your ${channel === 'email' ? 'email address' : 'phone number'} to your profile first.`,
      );
    const recent = await this.prisma.walletPinChallenge.findFirst({
      where: { userId, createdAt: { gt: new Date(Date.now() - 60000) } },
    });
    if (recent)
      throw new BadRequestException(
        'Wait one minute before requesting another code.',
      );
    const code = String(randomInt(100000, 1000000));
    // Persist the rate limit before contacting a provider; codes and PINs never enter logs.
    const challenge = await this.prisma.walletPinChallenge.create({
      data: {
        userId,
        channel,
        destination,
        codeHash: channel === 'email' ? await bcrypt.hash(code, 12) : null,
        expiresAt: new Date(Date.now() + 10 * 60000),
      },
    });
    try {
      if (channel === 'email') {
        if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
          throw new Error('unconfigured');
        const result = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          signal: AbortSignal.timeout(12000),
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `wallet-pin-${challenge.id}`,
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM,
            to: [destination],
            subject: 'Your Whazzonline wallet PIN code',
            text: `Your wallet PIN verification code is ${code}. It expires in 10 minutes. Never share this code.`,
          }),
        });
        if (!result.ok) throw new Error('provider');
      } else {
        if (!process.env.TERMII_API_KEY || !process.env.TERMII_BASE_URL)
          throw new Error('unconfigured');
        const result = await fetch(
          `${process.env.TERMII_BASE_URL.replace(/\/+$/, '')}/api/sms/otp/send`,
          {
            method: 'POST',
            signal: AbortSignal.timeout(12000),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: process.env.TERMII_API_KEY,
              pin_type: 'NUMERIC',
              message_type: 'NUMERIC',
              to: destination.replace(/^\+/, ''),
              from: process.env.TERMII_SENDER_ID?.trim() || 'N-Alert',
              channel: process.env.TERMII_CHANNEL?.trim() || 'generic',
              pin_placeholder: '<123456>',
              message_text:
                'Your Whazzonline wallet PIN verification code is <123456>. It expires in 10 minutes. Never share this code.',
              pin_attempts: 5,
              pin_time_to_live: 10,
              pin_length: 6,
            }),
          },
        );
        const data = (await result.json()) as {
          pin_id?: string;
          pinId?: string;
        };
        const providerId = data.pin_id || data.pinId;
        if (!result.ok || !providerId) throw new Error('provider');
        await this.prisma.walletPinChallenge.update({
          where: { id: challenge.id },
          data: { providerId },
        });
      }
    } catch {
      await this.prisma.walletPinChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      throw new ServiceUnavailableException(
        'Unable to send a wallet verification code. Please try again later.',
      );
    }
    return {
      challengeId: challenge.id,
      destination:
        channel === 'email'
          ? destination.replace(/(.{1}).*(@.*)/, '$1***$2')
          : `***${destination.slice(-4)}`,
      expiresIn: 600,
    };
  }

  async setPin(
    userId: string,
    dto: { challengeId?: string; code?: string; pin: string },
  ) {
    const wallet = await this.getWallet(userId);
    if (!wallet.pinHash && !dto.challengeId && !dto.code) {
      const pinHash = await bcrypt.hash(dto.pin, 12);
      const created = await this.prisma.wallet.updateMany({
        where: { userId, pinHash: null },
        data: { pinHash, pinAttempts: 0, pinLockedUntil: null },
      });
      if (!created.count)
        throw new BadRequestException(
          'A PIN is already configured. Verify your account to change it.',
        );
      return { configured: true };
    }
    if (!dto.challengeId || !dto.code)
      throw new BadRequestException(
        'Verify your account to change your wallet PIN.',
      );
    const challenge = await this.prisma.walletPinChallenge.findFirst({
      where: {
        id: dto.challengeId,
        userId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
    });
    if (!challenge)
      throw new BadRequestException('Request a new wallet verification code.');
    const attempt = await this.prisma.walletPinChallenge.updateMany({
      where: { id: challenge.id, attempts: { lt: 5 }, consumedAt: null },
      data: { attempts: { increment: 1 } },
    });
    if (!attempt.count)
      throw new BadRequestException('Request a new wallet verification code.');
    let valid = false;
    if (challenge.channel === 'email' && challenge.codeHash)
      valid = await bcrypt.compare(dto.code, challenge.codeHash);
    else if (challenge.providerId) {
      try {
        const response = await fetch(
          `${process.env.TERMII_BASE_URL?.replace(/\/+$/, '')}/api/sms/otp/verify`,
          {
            method: 'POST',
            signal: AbortSignal.timeout(12000),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: process.env.TERMII_API_KEY,
              pin_id: challenge.providerId,
              pin: dto.code,
            }),
          },
        );
        const data = (await response.json()) as { verified?: boolean | string };
        valid = response.ok && String(data.verified) === 'true';
      } catch {
        throw new ServiceUnavailableException(
          'Unable to verify this code. Please retry.',
        );
      }
    }
    if (!valid)
      throw new BadRequestException(
        'The verification code is incorrect or expired.',
      );
    const pinHash = await bcrypt.hash(dto.pin, 12);
    await this.getWallet(userId);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.walletPinChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (!consumed.count)
        throw new BadRequestException(
          'This verification code has already been used.',
        );
      await tx.wallet.update({
        where: { userId },
        data: { pinHash, pinAttempts: 0, pinLockedUntil: null },
      });
      await tx.walletPinChallenge.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
    });
    return { configured: true };
  }
}
