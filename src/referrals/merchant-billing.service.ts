import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from 'prisma/prisma.service';
import { Prisma } from 'generated/prisma/client';

// To be edited layter: merchant plan, NGN 5,000 per calendar month.
export const merchantPlan = {
  name: 'Merchant Monthly',
  amount: Number(process.env.MERCHANT_MONTHLY_PRICE_NGN || 5000),
  currency: 'NGN',
};
export function addMonths(date: Date, count: number) {
  const result = new Date(date),
    day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + count);
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}
export function earnsReward(period: number) {
  return period >= 4 && (period - 4) % 13 === 0;
}

@Injectable()
export class MerchantBillingService {
  constructor(private readonly prisma: PrismaService) {}
  private async provider(path: string, body?: object) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret)
      throw new ServiceUnavailableException(
        'Subscription payment is not configured yet.',
      );
    const response = await fetch(`https://api.paystack.co/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
    });
    const result = (await response.json()) as {
      status: boolean;
      data: Record<string, unknown>;
    };
    if (!response.ok || !result.status)
      throw new ServiceUnavailableException(
        'Payment provider is unavailable. Please try again.',
      );
    return result.data;
  }
  async summary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { vendorProfile: true },
    });
    if (
      !user?.isActive ||
      !user.isVerified ||
      !['VENDOR', 'BUSINESS'].includes(user.role) ||
      !user.vendorProfile?.setupCompleted
    )
      throw new BadRequestException(
        'Complete and verify your merchant account first.',
      );
    if (!Number.isSafeInteger(merchantPlan.amount) || merchantPlan.amount <= 0)
      throw new ServiceUnavailableException(
        'Monthly subscription price is invalid.',
      );
    const start =
      user.vendorProfile.submittedAt ?? user.vendorProfile.createdAt;
    const subscription = await this.prisma.merchantSubscription.upsert({
      where: { userId },
      create: {
        userId,
        trialStartedAt: start,
        trialEndsAt: addMonths(start, 1),
      },
      update: {},
      include: {
        payments: {
          where: { paidAt: { not: null } },
          orderBy: { period: 'desc' },
        },
      },
    });
    const nextPeriod = (subscription.payments[0]?.period ?? 0) + 1;
    return {
      ...merchantPlan,
      subscriptionId: subscription.id,
      trialStartedAt: subscription.trialStartedAt,
      trialEndsAt: subscription.trialEndsAt,
      trialActive: subscription.trialEndsAt.getTime() > Date.now(),
      paidPayments: subscription.payments.length,
      payments: subscription.payments.map((payment) => ({
        id: payment.id,
        period: payment.period,
        amount: payment.amount,
        paidAt: payment.paidAt,
        reference: payment.reference,
      })),
      nextPeriod,
      dueAt: addMonths(subscription.trialEndsAt, nextPeriod - 1),
      canPay:
        addMonths(subscription.trialEndsAt, nextPeriod - 1).getTime() <=
        Date.now(),
      email: user.email,
    };
  }
  async checkout(userId: string) {
    const summary = await this.summary(userId);
    if (summary.dueAt.getTime() > Date.now())
      throw new BadRequestException(
        'Your next subscription payment is not due yet.',
      );
    if (!summary.email)
      throw new BadRequestException(
        'Add an email address before paying your subscription.',
      );
    const payment = await this.prisma.subscriptionPayment.upsert({
      where: {
        subscriptionId_period: {
          subscriptionId: summary.subscriptionId,
          period: summary.nextPeriod,
        },
      },
      create: {
        subscriptionId: summary.subscriptionId,
        period: summary.nextPeriod,
        amount: summary.amount,
        reference: `merchant_${randomUUID()}`,
      },
      update: {},
    });
    if (payment.checkoutUrl)
      return { url: payment.checkoutUrl, reference: payment.reference };
    const data = await this.provider('transaction/initialize', {
      email: summary.email,
      amount: payment.amount * 100,
      currency: 'NGN',
      reference: payment.reference,
      callback_url: `${(process.env.FRONTEND_URL || 'https://whazzonline.com').replace(/\/$/, '')}/subscription?reference=${encodeURIComponent(payment.reference)}`,
      metadata: { purpose: 'merchant_subscription', paymentId: payment.id },
    });
    if (
      typeof data.authorization_url !== 'string' ||
      new URL(data.authorization_url).hostname !== 'checkout.paystack.com'
    )
      throw new ServiceUnavailableException(
        'Invalid payment checkout response.',
      );
    await this.prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: { checkoutUrl: data.authorization_url },
    });
    return { url: data.authorization_url, reference: payment.reference };
  }
  async verify(userId: string | null, reference: string) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { reference },
      include: { subscription: true },
    });
    if (!payment || (userId && payment.subscription.userId !== userId))
      throw new BadRequestException('Subscription payment not found.');
    if (payment.paidAt) return { paid: true };
    const data = await this.provider(
      `transaction/verify/${encodeURIComponent(reference)}`,
    );
    const customer = data.customer as { email?: string } | undefined;
    const user = await this.prisma.user.findUnique({
      where: { id: payment.subscription.userId },
      include: { vendorProfile: true },
    });
    if (data.status !== 'success')
      throw new BadRequestException(
        'This subscription payment has not succeeded.',
      );
    if (
      data.reference !== reference ||
      data.currency !== 'NGN' ||
      data.amount !== payment.amount * 100 ||
      customer?.email?.toLowerCase() !== user?.email?.toLowerCase()
    )
      throw new BadRequestException(
        'Subscription payment details do not match.',
      );
    const paidAt = new Date(String(data.paid_at));
    if (
      !Number.isFinite(paidAt.getTime()) ||
      paidAt < addMonths(payment.subscription.trialEndsAt, payment.period - 1)
    )
      throw new BadRequestException(
        'Payment precedes its subscription period.',
      );
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const claimed = await tx.subscriptionPayment.updateMany({
              where: { id: payment.id, paidAt: null },
              data: { paidAt },
            });
            if (!claimed.count) return;
            const previous = await tx.subscriptionPayment.count({
              where: {
                subscriptionId: payment.subscriptionId,
                paidAt: { not: null },
                period: { lt: payment.period },
              },
            });
            if (previous !== payment.period - 1)
              throw new BadRequestException(
                'Settle earlier subscription payments first.',
              );
            const referral = await tx.referral.findUnique({
              where: { refereeUserId: payment.subscription.userId },
              include: { referrer: true },
            });
            if (
              !referral ||
              !earnsReward(payment.period) ||
              !user?.isActive ||
              !user.isVerified ||
              !user.vendorProfile?.setupCompleted ||
              !referral.referrer.isActive ||
              !referral.referrer.isVerified
            )
              return;
            const wallet = await tx.wallet.upsert({
              where: { userId: referral.referrerUserId },
              create: {
                userId: referral.referrerUserId,
                availableBalance: payment.amount,
                referralBonus: payment.amount,
              },
              update: {
                availableBalance: { increment: payment.amount },
                referralBonus: { increment: payment.amount },
              },
            });
            const transaction = await tx.walletTransaction.create({
              data: {
                walletId: wallet.id,
                amount: payment.amount,
                description: `Referral Bonus - ${user.vendorProfile.storeName}`,
                type: 'REFERRAL_BONUS',
                status: 'COMPLETED',
              },
            });
            await tx.referralReward.create({
              data: {
                referralId: referral.id,
                paymentId: payment.id,
                transactionId: transaction.id,
                amount: payment.amount,
              },
            });
            await tx.referral.update({
              where: { id: referral.id },
              data: {
                status: 'COMPLETED',
                completedAt: referral.completedAt ?? paidAt,
                rewardAmount: { increment: payment.amount },
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return { paid: true };
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt === 3
        )
          throw error;
      }
    }
  }
  async webhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    event: { event?: string; data?: { reference?: string } },
  ) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (
      !secret ||
      !rawBody ||
      !signature ||
      !/^[a-f0-9]{128}$/i.test(signature)
    )
      throw new UnauthorizedException('Invalid payment signature.');
    const expected = createHmac('sha512', secret).update(rawBody).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      throw new UnauthorizedException('Invalid payment signature.');
    if (
      event.event === 'charge.success' &&
      event.data?.reference?.startsWith('merchant_')
    )
      await this.verify(null, event.data.reference);
    return { received: true };
  }
}
