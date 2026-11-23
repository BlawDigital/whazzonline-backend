import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'prisma/prisma.service';

/** The steps of the referral journey, recorded so rewards can be explained. */
export const referralEventTypes = [
  'LINK_OPENED',
  'SIGNED_UP',
  'QUALIFIED',
  'REWARDED',
  'INELIGIBLE',
  'EXPIRED',
  'VOIDED',
] as const;
export type ReferralEventType = (typeof referralEventTypes)[number];

type EventClient = Pick<PrismaService, 'referralEvent'>;

/** Best effort: the journey log must never block signup or fulfilment. */
export async function recordReferralEvent(
  client: EventClient | Prisma.TransactionClient,
  event: {
    referrerUserId: string;
    referralId?: string | null;
    type: ReferralEventType;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await client.referralEvent.create({
      data: {
        referrerUserId: event.referrerUserId,
        referralId: event.referralId ?? null,
        type: event.type,
        metadata: (event.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch {
    /* Ignored on purpose; see above. */
  }
}
