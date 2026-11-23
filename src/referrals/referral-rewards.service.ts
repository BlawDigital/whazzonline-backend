import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { Prisma } from 'generated/prisma/client';

export type ReferralRules = {
  enabled: boolean;
  minOrderValue: number;
  rewardAmount: number;
  qualificationWindowDays: number;
  firstOrderOnly: boolean;
};

export const defaultReferralRules: ReferralRules = {
  enabled: true,
  minOrderValue: 5000,
  rewardAmount: 500,
  qualificationWindowDays: 30,
  firstOrderOnly: true,
};

export type EligibilityInput = {
  rules: ReferralRules;
  referralCreatedAt: Date;
  orderSubtotal: number;
  orderPaid: boolean;
  deliveredAt: Date;
  selfReferral: boolean;
  referrerActive: boolean;
  earlierDeliveredOrders: number;
};

/** Pure rule evaluation, so the rules stay easy to test and to configure. */
export function evaluateEligibility(
  input: EligibilityInput,
): { eligible: true } | { eligible: false; reason: string } {
  const { rules } = input;
  if (!rules.enabled)
    return { eligible: false, reason: 'The referral programme is paused.' };
  if (input.selfReferral)
    return { eligible: false, reason: 'You cannot refer yourself.' };
  if (!input.referrerActive)
    return { eligible: false, reason: 'The referrer account is not active.' };
  if (!input.orderPaid)
    return { eligible: false, reason: 'The qualifying order was not paid.' };
  if (rules.firstOrderOnly && input.earlierDeliveredOrders > 0)
    return {
      eligible: false,
      reason: 'Friend is a returning customer, not a new user.',
    };
  if (input.orderSubtotal < rules.minOrderValue)
    return {
      eligible: false,
      reason: `Order was below the minimum of ₦${rules.minOrderValue.toLocaleString()}.`,
    };
  const deadline =
    input.referralCreatedAt.getTime() +
    rules.qualificationWindowDays * 86400000;
  if (input.deliveredAt.getTime() > deadline)
    return {
      eligible: false,
      reason: `Friend did not complete a purchase within ${rules.qualificationWindowDays} days.`,
    };
  return { eligible: true };
}

const MAX_ATTEMPTS = 5;
const SWEEP_INTERVAL_MS = 60_000;
const STALE_PROCESSING_MS = 5 * 60_000;

@Injectable()
export class ReferralRewardsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReferralRewardsService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
    this.timer = setInterval(() => {
      void this.sweep().catch((error: unknown) =>
        this.logger.error(`Referral sweep failed: ${String(error)}`),
      );
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ----- configuration -----------------------------------------------------
  async rules(): Promise<ReferralRules> {
    const row = await this.prisma.referralProgramConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    return {
      enabled: row.enabled,
      minOrderValue: row.minOrderValue,
      rewardAmount: row.rewardAmount,
      qualificationWindowDays: row.qualificationWindowDays,
      firstOrderOnly: row.firstOrderOnly,
    };
  }
  async updateRules(patch: Partial<ReferralRules>) {
    await this.prisma.referralProgramConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...patch },
      update: patch,
    });
    return this.rules();
  }

  // ----- helpers -----------------------------------------------------------
  private async audit(
    referralId: string | null,
    event: string,
    details: Record<string, unknown> = {},
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    await client.referralAuditLog.create({
      data: {
        referralId,
        event,
        details: details as Prisma.InputJsonValue,
      },
    });
  }
  private async notify(
    userId: string,
    referralId: string,
    title: string,
    body: string,
  ) {
    try {
      await this.prisma.referralNotification.create({
        data: { userId, referralId, title, body },
      });
      // Push/email delivery plugs in here; the in-app notice is the record.
      this.logger.log(`Referral notice for ${userId}: ${title}`);
    } catch (error) {
      this.logger.warn(`Could not notify referrer: ${String(error)}`);
    }
  }

  // ----- event: order delivered -------------------------------------------
  /** Safe to call repeatedly: a referral qualifies at most once. */
  async onOrderDelivered(orderId: string) {
    try {
      await this.qualify(orderId);
    } catch (error) {
      // Never break order fulfilment because of the rewards engine.
      this.logger.error(`Referral qualification failed: ${String(error)}`);
    }
  }

  async qualify(orderId: string) {
    const order = await this.prisma.commerceOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        paymentStatus: true,
        subtotal: true,
        completedAt: true,
      },
    });
    if (!order?.userId || order.status !== 'delivered') return null;
    const referral = await this.prisma.referral.findUnique({
      where: { refereeUserId: order.userId },
      include: {
        referee: { select: { registrationType: true } },
        referrer: { select: { isActive: true } },
      },
    });
    // Merchant referrals are rewarded through subscription payments instead.
    if (!referral || referral.referee?.registrationType !== 'BUYER')
      return null;

    if (referral.status !== 'PENDING') {
      await this.audit(referral.id, 'DUPLICATE_QUALIFICATION_IGNORED', {
        orderId,
        status: referral.status,
        qualifyingOrderId: referral.qualifyingOrderId,
      });
      return null;
    }

    const rules = await this.rules();
    const earlier = await this.prisma.commerceOrder.count({
      where: {
        userId: order.userId,
        status: 'delivered',
        id: { not: orderId },
        completedAt: { lt: order.completedAt ?? new Date() },
      },
    });
    const verdict = evaluateEligibility({
      rules,
      referralCreatedAt: referral.createdAt,
      orderSubtotal: order.subtotal,
      orderPaid: ['paid', 'partial'].includes(order.paymentStatus),
      deliveredAt: order.completedAt ?? new Date(),
      selfReferral: referral.referrerUserId === order.userId,
      referrerActive: referral.referrer.isActive,
      earlierDeliveredOrders: earlier,
    });

    if (!verdict.eligible) {
      const claimed = await this.prisma.referral.updateMany({
        where: { id: referral.id, status: 'PENDING' },
        data: { status: 'INELIGIBLE', statusReason: verdict.reason },
      });
      if (!claimed.count) return null;
      await this.audit(referral.id, 'INELIGIBLE', {
        orderId,
        reason: verdict.reason,
      });
      await this.notify(
        referral.referrerUserId,
        referral.id,
        'Referral not eligible',
        `${referral.refereeName} did not qualify for a reward. ${verdict.reason}`,
      );
      return { status: 'INELIGIBLE' as const };
    }

    let payoutId: string;
    try {
      payoutId = await this.prisma.$transaction(async (tx) => {
        // Claim the PENDING -> QUALIFIED transition once; repeats see count 0.
        const claimed = await tx.referral.updateMany({
          where: { id: referral.id, status: 'PENDING' },
          data: {
            status: 'QUALIFIED',
            qualifiedAt: new Date(),
            qualifyingOrderId: orderId,
            statusReason: null,
            rewardAmount: rules.rewardAmount,
          },
        });
        if (!claimed.count) throw new DuplicateQualification();
        const payout = await tx.referralPayout.create({
          data: {
            referralId: referral.id,
            orderId,
            amount: rules.rewardAmount,
          },
        });
        await this.audit(
          referral.id,
          'QUALIFIED',
          { orderId, payoutId: payout.id, amount: rules.rewardAmount },
          tx,
        );
        return payout.id;
      });
    } catch (error) {
      if (
        error instanceof DuplicateQualification ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002')
      ) {
        await this.audit(referral.id, 'DUPLICATE_REWARD_BLOCKED', { orderId });
        return null;
      }
      throw error;
    }
    void this.processPayout(payoutId).catch((error: unknown) =>
      this.logger.error(`Payout ${payoutId} failed: ${String(error)}`),
    );
    return { status: 'QUALIFIED' as const, payoutId };
  }

  // ----- background job: disburse reward ----------------------------------
  async processPayout(payoutId: string) {
    const claimed = await this.prisma.referralPayout.updateMany({
      where: {
        id: payoutId,
        status: 'QUEUED',
        nextAttemptAt: { lte: new Date() },
      },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    if (!claimed.count) return false;
    try {
      const rewardedFor = await this.prisma.$transaction(async (tx) => {
        const payout = await tx.referralPayout.findUniqueOrThrow({
          where: { id: payoutId },
          include: { referral: true },
        });
        if (payout.referral.status !== 'QUALIFIED') {
          await tx.referralPayout.update({
            where: { id: payoutId },
            data: { status: 'CANCELLED', lastError: 'Referral not qualified.' },
          });
          await this.audit(
            payout.referralId,
            'PAYOUT_CANCELLED',
            { status: payout.referral.status },
            tx,
          );
          return null;
        }
        const wallet = await tx.wallet.upsert({
          where: { userId: payout.referral.referrerUserId },
          create: {
            userId: payout.referral.referrerUserId,
            availableBalance: payout.amount,
            referralBonus: payout.amount,
          },
          update: {
            availableBalance: { increment: payout.amount },
            referralBonus: { increment: payout.amount },
          },
        });
        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            amount: payout.amount,
            description: `Referral Bonus - ${payout.referral.refereeName}`,
            reference: `referral-payout:${payout.id}`,
            type: 'REFERRAL_BONUS',
            status: 'COMPLETED',
          },
        });
        await tx.referralPayout.update({
          where: { id: payoutId },
          data: { status: 'PAID', transactionId: transaction.id },
        });
        await tx.referral.update({
          where: { id: payout.referralId },
          data: { status: 'REWARDED', completedAt: new Date() },
        });
        await this.audit(
          payout.referralId,
          'REWARDED',
          { payoutId, amount: payout.amount },
          tx,
        );
        return payout;
      });
      if (rewardedFor)
        await this.notify(
          rewardedFor.referral.referrerUserId,
          rewardedFor.referralId,
          'Referral reward sent',
          `₦${rewardedFor.amount.toLocaleString()} was added to your wallet for referring ${rewardedFor.referral.refereeName}.`,
        );
      return true;
    } catch (error) {
      const payout = await this.prisma.referralPayout.findUnique({
        where: { id: payoutId },
        select: { attempts: true, referralId: true },
      });
      const exhausted = (payout?.attempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS;
      await this.prisma.referralPayout.update({
        where: { id: payoutId },
        data: {
          status: exhausted ? 'FAILED' : 'QUEUED',
          lastError: String(error).slice(0, 500),
          nextAttemptAt: new Date(
            Date.now() + 2 ** (payout?.attempts ?? 1) * 30_000,
          ),
        },
      });
      await this.audit(payout?.referralId ?? null, 'PAYOUT_ERROR', {
        payoutId,
        exhausted,
        error: String(error).slice(0, 300),
      });
      return false;
    }
  }

  // ----- event: order refunded / charged back ------------------------------
  async onOrderReversed(orderId: string, cause = 'refund') {
    const referral = await this.prisma.referral.findUnique({
      where: { qualifyingOrderId: orderId },
      include: { payout: true },
    });
    if (!referral || !['QUALIFIED', 'REWARDED'].includes(referral.status))
      return null;
    const reason = `Qualifying order was reversed (${cause}).`;
    await this.prisma.$transaction(async (tx) => {
      await tx.referralPayout.updateMany({
        where: {
          referralId: referral.id,
          status: { in: ['QUEUED', 'PROCESSING'] },
        },
        data: { status: 'CANCELLED', lastError: reason },
      });
      await tx.referral.update({
        where: { id: referral.id },
        data: { status: 'VOIDED', statusReason: reason },
      });
      await this.audit(
        referral.id,
        referral.payout?.status === 'PAID'
          ? 'VOIDED_AFTER_PAYOUT_REVIEW_REQUIRED'
          : 'VOIDED',
        { orderId, cause, payoutStatus: referral.payout?.status ?? null },
        tx,
      );
    });
    await this.notify(
      referral.referrerUserId,
      referral.id,
      'Referral reward voided',
      `${referral.refereeName}'s order was reversed, so the referral no longer counts.`,
    );
    return { status: 'VOIDED' as const };
  }

  // ----- periodic sweep ----------------------------------------------------
  async sweep(now = new Date()) {
    await this.prisma.referralPayout.updateMany({
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: new Date(now.getTime() - STALE_PROCESSING_MS) },
      },
      data: { status: 'QUEUED' },
    });
    const due = await this.prisma.referralPayout.findMany({
      where: { status: 'QUEUED', nextAttemptAt: { lte: now } },
      select: { id: true },
      take: 25,
      orderBy: { nextAttemptAt: 'asc' },
    });
    for (const { id } of due) await this.processPayout(id);
    await this.expirePending(now);
  }

  /** Buyer referrals with no qualifying purchase inside the window. */
  async expirePending(now = new Date()) {
    const rules = await this.rules();
    const cutoff = new Date(
      now.getTime() - rules.qualificationWindowDays * 86400000,
    );
    const stale = await this.prisma.referral.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: cutoff },
        referee: { registrationType: 'BUYER' },
      },
      select: { id: true, referrerUserId: true, refereeName: true },
      take: 100,
    });
    const reason = `Friend did not complete a purchase within ${rules.qualificationWindowDays} days.`;
    for (const referral of stale) {
      const claimed = await this.prisma.referral.updateMany({
        where: { id: referral.id, status: 'PENDING' },
        data: { status: 'INELIGIBLE', statusReason: reason },
      });
      if (!claimed.count) continue;
      await this.audit(referral.id, 'EXPIRED', { reason });
      await this.notify(
        referral.referrerUserId,
        referral.id,
        'Referral expired',
        `${referral.refereeName} did not qualify. ${reason}`,
      );
    }
    return stale.length;
  }
}

class DuplicateQualification extends Error {}
