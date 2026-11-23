import { Prisma } from 'generated/prisma/client';
import {
  ensureReferralCode,
  generateReferralCode,
  referralCodeCandidates,
  REFERRAL_CODE_ALPHABET,
} from './referral-code';

describe('generateReferralCode', () => {
  it('is 8 characters, alphanumeric and free of ambiguous characters', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateReferralCode();
      expect(code).toMatch(/^[A-Z2-9]{8}$/);
      expect(code).not.toMatch(/[0OI1L]/);
    }
    expect(REFERRAL_CODE_ALPHABET).not.toMatch(/[0OIL1]/);
  });
  it('stays inside the 6-8 character range', () => {
    expect(generateReferralCode().length).toBeGreaterThanOrEqual(6);
    expect(generateReferralCode().length).toBeLessThanOrEqual(8);
  });
  it('produces varied codes', () => {
    const codes = new Set(
      Array.from({ length: 200 }, () => generateReferralCode()),
    );
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe('referralCodeCandidates', () => {
  it('matches codes case-insensitively', () => {
    expect(referralCodeCandidates(' abcd2345 ')).toEqual([
      'abcd2345',
      'ABCD2345',
    ]);
    expect(referralCodeCandidates('ABCD2345')).toEqual(['ABCD2345']);
  });
});

describe('ensureReferralCode', () => {
  function build(initial: string | null) {
    let stored = initial;
    const updateMany = jest.fn(
      async ({ data }: { data: { referralCode: string } }) => {
        if (stored) return { count: 0 };
        stored = data.referralCode;
        return { count: 1 };
      },
    );
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ referralCode: stored })),
        updateMany,
      },
    };
    return {
      prisma,
      updateMany,
      get stored() {
        return stored;
      },
    };
  }

  it('never changes a code that already exists', async () => {
    const ctx = build('KEEPME22');
    await expect(ensureReferralCode(ctx.prisma as never, 'u1')).resolves.toBe(
      'KEEPME22',
    );
    expect(ctx.updateMany).not.toHaveBeenCalled();
  });

  it('only writes where the code is still empty, so repeats keep the first value', async () => {
    const ctx = build(null);
    const first = await ensureReferralCode(ctx.prisma as never, 'u1');
    const second = await ensureReferralCode(ctx.prisma as never, 'u1');
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Z2-9]{8}$/);
    expect(ctx.updateMany).toHaveBeenCalledTimes(1);
    expect(ctx.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'u1', referralCode: null },
    });
  });

  it('retries with a new code after a uniqueness collision', async () => {
    let stored: string | null = null;
    let calls = 0;
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ referralCode: stored })),
        updateMany: jest.fn(
          async ({ data }: { data: { referralCode: string } }) => {
            if (calls++ === 0)
              throw new Prisma.PrismaClientKnownRequestError('dup', {
                code: 'P2002',
                clientVersion: 'test',
              });
            stored = data.referralCode;
            return { count: 1 };
          },
        ),
      },
    };
    await expect(ensureReferralCode(prisma as never, 'u1')).resolves.toMatch(
      /^[A-Z2-9]{8}$/,
    );
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(2);
  });

  it('returns null for an unknown user', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => null), updateMany: jest.fn() },
    };
    await expect(ensureReferralCode(prisma as never, 'x')).resolves.toBeNull();
  });
});
