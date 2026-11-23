import {
  defaultReferralRules,
  evaluateEligibility,
  ReferralRewardsService,
  type EligibilityInput,
} from './referral-rewards.service';

const base = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  rules: defaultReferralRules,
  referralCreatedAt: new Date('2026-01-01T00:00:00Z'),
  orderSubtotal: 6000,
  orderPaid: true,
  deliveredAt: new Date('2026-01-05T00:00:00Z'),
  selfReferral: false,
  referrerActive: true,
  earlierDeliveredOrders: 0,
  ...over,
});

describe('evaluateEligibility', () => {
  it('accepts a first paid order above the minimum inside the window', () => {
    expect(evaluateEligibility(base())).toEqual({ eligible: true });
  });
  it('rejects orders below the configurable minimum value', () => {
    expect(evaluateEligibility(base({ orderSubtotal: 4999 }))).toMatchObject({
      eligible: false,
      reason: expect.stringContaining('minimum'),
    });
    expect(
      evaluateEligibility(
        base({
          orderSubtotal: 4999,
          rules: { ...defaultReferralRules, minOrderValue: 1000 },
        }),
      ),
    ).toEqual({ eligible: true });
  });
  it('rejects returning customers unless first-order-only is switched off', () => {
    const returning = base({ earlierDeliveredOrders: 2 });
    expect(evaluateEligibility(returning)).toMatchObject({ eligible: false });
    expect(
      evaluateEligibility({
        ...returning,
        rules: { ...defaultReferralRules, firstOrderOnly: false },
      }),
    ).toEqual({ eligible: true });
  });
  it('rejects deliveries outside the qualification window', () => {
    expect(
      evaluateEligibility(
        base({ deliveredAt: new Date('2026-02-15T00:00:00Z') }),
      ),
    ).toMatchObject({
      eligible: false,
      reason: expect.stringContaining('30 days'),
    });
  });
  it('rejects self referrals, inactive referrers, unpaid orders and a paused programme', () => {
    for (const over of [
      { selfReferral: true },
      { referrerActive: false },
      { orderPaid: false },
      { rules: { ...defaultReferralRules, enabled: false } },
    ])
      expect(evaluateEligibility(base(over))).toMatchObject({
        eligible: false,
      });
  });
});

describe('ReferralRewardsService duplicate protection', () => {
  const order = {
    id: 'order-1',
    userId: 'referee',
    status: 'delivered',
    paymentStatus: 'paid',
    subtotal: 9000,
    completedAt: new Date(),
  };
  function build(referralStatus: string) {
    const audit = jest.fn().mockResolvedValue({});
    const prisma = {
      commerceOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
        count: jest.fn().mockResolvedValue(0),
      },
      referral: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ref-1',
          status: referralStatus,
          createdAt: new Date(Date.now() - 86400000),
          referrerUserId: 'referrer',
          refereeName: 'Friend',
          qualifyingOrderId: 'order-1',
          referee: { registrationType: 'BUYER' },
          referrer: { isActive: true },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      referralProgramConfig: {
        upsert: jest.fn().mockResolvedValue({
          ...defaultReferralRules,
        }),
      },
      referralAuditLog: { create: audit },
      referralPayout: { create: jest.fn() },
      $transaction: jest.fn(
        async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
      ),
    };
    return {
      audit,
      prisma,
      service: new ReferralRewardsService(prisma as never),
    };
  }

  it('ignores a second delivery event for an already qualified referral and logs it', async () => {
    const { service, prisma, audit } = build('QUALIFIED');
    await expect(service.qualify('order-1')).resolves.toBeNull();
    expect(prisma.referralPayout.create).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        referralId: 'ref-1',
        event: 'DUPLICATE_QUALIFICATION_IGNORED',
      }),
    });
  });

  it('does not create a payout when a concurrent event already claimed the referral', async () => {
    const { service, prisma, audit } = build('PENDING');
    await expect(service.qualify('order-1')).resolves.toBeNull();
    expect(prisma.referralPayout.create).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith({
      data: expect.objectContaining({ event: 'DUPLICATE_REWARD_BLOCKED' }),
    });
  });
});
