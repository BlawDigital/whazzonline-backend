import { randomInt } from 'node:crypto';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'prisma/prisma.service';

/** Upper-case letters and digits without the look-alikes 0, O, 1, I and L. */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;

export function generateReferralCode(length = REFERRAL_CODE_LENGTH) {
  let code = '';
  for (let i = 0; i < length; i++)
    code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  return code;
}

/** Codes issued before this format were longer hex strings; they stay valid. */
export function referralCodeCandidates(input: string) {
  const code = input.trim();
  return [...new Set([code, code.toUpperCase()])];
}

type CodeClient = Pick<PrismaService, 'user'>;

/**
 * Returns the user's referral code, creating it the first time only.
 * An existing code is never changed: the write only matches rows with no code.
 */
export async function ensureReferralCode(
  prisma: CodeClient,
  userId: string,
  attempts = 5,
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!user) return null;
    if (user.referralCode) return user.referralCode;
    try {
      const claimed = await prisma.user.updateMany({
        where: { id: userId, referralCode: null },
        data: { referralCode: generateReferralCode() },
      });
      if (claimed.count) continue; // re-read the stored value below
    } catch (error) {
      // A collision with another user's code: try a new one.
      if (!(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ))
        throw error;
    }
  }
  const final = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  return final?.referralCode ?? null;
}
