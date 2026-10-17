import { VendorsService } from '../vendors/vendors.service';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import {
  MerchantBillingController,
  ReferralPaymentWebhookController,
} from './merchant-billing.controller';
import { ReferralInvitationsController } from './referral-invitations.controller';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MerchantBillingService,
  addMonths,
  earnsReward,
} from './merchant-billing.service';
import { ReferralsService } from './referrals.service';
import { ReferralsController } from './referrals.controller';
import { AuthService } from '../auth/auth.service';

jest.setTimeout(180000);
const databaseTests =
  process.env.RUN_REFERRAL_DATABASE_TESTS === '1' ? describe : describe.skip;
describe('referral payment rules', () => {
  it('rewards paid months 4, 17 and 30, with twelve standard payments between rewards', () => {
    expect(
      Array.from({ length: 31 }, (_, i) => i + 1).filter(earnsReward),
    ).toEqual([4, 17, 30]);
  });
  it('clamps calendar month anniversaries without drifting at month ends', () => {
    expect(addMonths(new Date('2026-01-31T12:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    );
    expect(addMonths(new Date('2024-01-31T12:00:00Z'), 1).toISOString()).toBe(
      '2024-02-29T12:00:00.000Z',
    );
  });
  it('enforces ownership before querying referral details', () => {
    const controller = new ReferralsController({
      detail: jest.fn(),
    } as unknown as ReferralsService);
    expect(() =>
      controller.detail({ user: { sub: 'other' } } as never, 'owner', 'record'),
    ).toThrow('own referrals');
  });
});
databaseTests('referral database and payment integration', () => {
  let prisma: PrismaService,
    admin: Client,
    billing: MerchantBillingService,
    referrals: ReferralsService;
  let owner: string,
    merchant: string,
    subscriptionId: string,
    referralId: string;
  const database = `referral_test_${process.pid}`,
    secret = 'test-only-referral-secret';
  const originalFetch = global.fetch,
    originalUrl = process.env.DATABASE_URL,
    originalSecret = process.env.PAYSTACK_SECRET_KEY;
  let verified: Record<string, unknown> = {};
  beforeAll(async () => {
    const container = JSON.parse(
      execFileSync('docker', ['inspect', 'whazzonline-postgres'], {
        encoding: 'utf8',
      }),
    )[0] as { Config: { Env: string[] } };
    const env = Object.fromEntries(
      container.Config.Env.map((v) => {
        const i = v.indexOf('=');
        return [v.slice(0, i), v.slice(i + 1)];
      }),
    );
    const url = new URL(
      `postgresql://localhost:5433/${env.POSTGRES_DB || env.POSTGRES_USER}`,
    );
    url.username = env.POSTGRES_USER;
    url.password = env.POSTGRES_PASSWORD;
    admin = new Client({ connectionString: url.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    url.pathname = `/${database}`;
    process.env.DATABASE_URL = url.toString();
    process.env.PAYSTACK_SECRET_KEY = secret;
    execFileSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'db', 'push'],
      { env: process.env, stdio: 'pipe', timeout: 180000 },
    );
    prisma = new PrismaService();
    await prisma.$connect();
    billing = new MerchantBillingService(prisma);
    referrals = new ReferralsService(prisma);
    owner = (
      await prisma.user.create({
        data: {
          firstName: 'Referrer',
          email: `owner-${randomUUID()}@example.com`,
          isActive: true,
          isVerified: true,
          referralCode: 'test-referral-invitation',
        },
      })
    ).id;
    merchant = (
      await prisma.user.create({
        data: {
          firstName: 'Merchant',
          email: `merchant-${randomUUID()}@example.com`,
          role: 'VENDOR',
          registrationType: 'SELLER',
          isActive: true,
          isVerified: true,
        },
      })
    ).id;
    referralId = (
      await prisma.referral.create({
        data: {
          referrerUserId: owner,
          refereeUserId: merchant,
          refereeName: 'Test Store',
          rewardAmount: 0,
        },
      })
    ).id;
    await prisma.vendorProfile.create({
      data: {
        userId: merchant,
        storeName: 'Test Store',
        category: 'Fashion',
        subCategory: 'Clothes',
        state: 'Lagos',
        city: 'Lagos',
        lga: 'Yaba',
        address: 'Test address',
        description: 'Test merchant',
        setupCompleted: true,
        submittedAt: new Date('2020-01-01'),
      },
    });
    subscriptionId = (
      await prisma.merchantSubscription.create({
        data: {
          userId: merchant,
          trialStartedAt: new Date('2020-01-01'),
          trialEndsAt: new Date('2020-02-01'),
        },
      })
    ).id;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ status: true, data: verified }),
    })) as unknown as typeof fetch;
  }, 240000);
  afterAll(async () => {
    global.fetch = originalFetch;
    process.env.DATABASE_URL = originalUrl;
    process.env.PAYSTACK_SECRET_KEY = originalSecret;
    if (prisma) await prisma.$disconnect();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    }
  });
  async function payment(period: number) {
    const record = await prisma.subscriptionPayment.create({
      data: {
        subscriptionId,
        period,
        reference: `merchant_${randomUUID()}`,
        amount: 5000,
      },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: merchant },
    });
    verified = {
      status: 'success',
      reference: record.reference,
      currency: 'NGN',
      amount: 500000,
      paid_at: addMonths(new Date('2020-02-01'), period - 1).toISOString(),
      customer: { email: user.email },
    };
    return record;
  }
  it('captures a valid invitation in merchant registration atomically', async () => {
    const auth = new AuthService(
      prisma,
      {} as never,
      { signAsync: async () => 'test-token' } as never,
    );
    const result = await auth.register({
      email: `invited-${randomUUID()}@example.com`,
      password: 'test-password',
      registrationType: 'SELLER',
      firstName: 'Invited',
      referralCode: 'test-referral-invitation',
    });
    expect(
      await prisma.referral.findUnique({
        where: { refereeUserId: result.user.id },
      }),
    ).toMatchObject({
      referrerUserId: owner,
      status: 'PENDING',
      rewardAmount: 0,
    });
    await expect(
      auth.register({
        email: `buyer-${randomUUID()}@example.com`,
        password: 'test-password',
        registrationType: 'BUYER',
        referralCode: 'test-referral-invitation',
      }),
    ).rejects.toThrow('merchant account');
    await expect(referrals.resolve('missing-code')).rejects.toThrow('invalid');
  });
  it('credits the whole 4th, 17th and 30th payments exactly once', async () => {
    for (let period = 1; period <= 30; period++) {
      const record = await payment(period);
      await Promise.all([
        billing.verify(merchant, record.reference),
        billing.verify(merchant, record.reference),
      ]);
      const balance = await prisma.wallet.findUnique({
        where: { userId: owner },
      });
      expect(balance?.referralBonus ?? 0).toBe(
        period < 4 ? 0 : period < 17 ? 5000 : period < 30 ? 10000 : 15000,
      );
      await billing.verify(merchant, record.reference);
    }
    expect(await prisma.referralReward.count({ where: { referralId } })).toBe(
      3,
    );
    expect(
      await prisma.walletTransaction.count({
        where: { wallet: { userId: owner }, type: 'REFERRAL_BONUS' },
      }),
    ).toBe(3);
    const overview = await referrals.overview(owner);
    expect(overview.referralLink).toContain('/ref/test-referral-invitation');
    expect(overview.summary.totalRewards).toBe(15000);
    const details = await referrals.detail(owner, referralId);
    expect(details.vendor.id).toBe(merchant);
    expect(details.progress[4].state).toBe('complete');
    expect(details.progress[5].state).toBe('current');
    const history = await referrals.rewards(owner, {
      page: 1,
      q: 'Test Store',
    });
    expect(history.total).toBe(3);
    await expect(referrals.detail(merchant, referralId)).rejects.toThrow(
      'not found',
    );
  });
  it('rejects forged webhooks, wrong amounts, wrong currency and cross-account verification', async () => {
    const record = await payment(31);
    await expect(billing.verify(owner, record.reference)).rejects.toThrow(
      'not found',
    );
    verified = { ...verified, amount: 1 };
    await expect(billing.verify(merchant, record.reference)).rejects.toThrow(
      'do not match',
    );
    verified = { ...verified, amount: 500000, currency: 'USD' };
    await expect(billing.verify(merchant, record.reference)).rejects.toThrow(
      'do not match',
    );
    const body = Buffer.from(
      JSON.stringify({
        event: 'charge.success',
        data: { reference: record.reference },
      }),
    );
    await expect(
      billing.webhook(body, '0'.repeat(128), JSON.parse(body.toString())),
    ).rejects.toThrow('signature');
    const shopping = Buffer.from(
      JSON.stringify({
        event: 'charge.success',
        data: { reference: 'shopping-order' },
      }),
    );
    expect(
      await billing.webhook(
        shopping,
        createHmac('sha512', secret).update(shopping).digest('hex'),
        JSON.parse(shopping.toString()),
      ),
    ).toEqual({ received: true });
    expect(
      (
        await prisma.subscriptionPayment.findUniqueOrThrow({
          where: { id: record.id },
        })
      ).paidAt,
    ).toBeNull();
  });
  it('reuses checkout after interruption and verifies a signed success event', async () => {
    const record = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { subscriptionId_period: { subscriptionId, period: 31 } },
    });
    verified = {
      authorization_url: 'https://checkout.paystack.com/test-referral',
    };
    const first = await billing.checkout(merchant);
    const summary = await billing.summary(merchant);
    expect(summary.payments.length).toBe(summary.paidPayments);
    expect(
      summary.payments.every((payment) => payment.paidAt && payment.amount > 0),
    ).toBe(true);
    const calls = (global.fetch as jest.Mock).mock.calls.length;
    expect(await billing.checkout(merchant)).toEqual(first);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(calls);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: merchant },
    });
    verified = {
      status: 'success',
      reference: record.reference,
      currency: 'NGN',
      amount: 500000,
      paid_at: addMonths(new Date('2020-02-01'), 30).toISOString(),
      customer: { email: user.email },
    };
    const body = Buffer.from(
      JSON.stringify({
        event: 'charge.success',
        data: { reference: record.reference },
      }),
    );
    expect(
      await billing.webhook(
        body,
        createHmac('sha512', secret).update(body).digest('hex'),
        JSON.parse(body.toString()),
      ),
    ).toEqual({ received: true });
    expect(
      (
        await prisma.subscriptionPayment.findUniqueOrThrow({
          where: { id: record.id },
        })
      ).paidAt,
    ).not.toBeNull();
    expect(await prisma.referralReward.count({ where: { referralId } })).toBe(
      3,
    );
  });
  it('paginates and filters independently of details and never fabricates legacy payment activity', async () => {
    const legacy = await prisma.referral.create({
      data: { referrerUserId: owner, refereeName: 'Historical Merchant' },
    });
    const listed = await referrals.list(owner, {
      page: 1,
      pageSize: 1,
      status: 'PENDING',
      q: 'Historical',
    });
    expect(listed.total).toBe(1);
    expect(listed.items).toHaveLength(1);
    const detail = await referrals.detail(owner, legacy.id);
    expect(detail.progress[2].state).toBe('pending');
    expect(detail.progress[3].timestamp).toBeNull();
  });
  it('starts the free month on store submission and never resets it on resubmission', async () => {
    const newMerchant = await prisma.user.create({
      data: {
        role: 'VENDOR',
        registrationType: 'SELLER',
        isActive: true,
        isVerified: true,
        email: `trial-${randomUUID()}@example.com`,
      },
    });
    await prisma.vendorProfile.create({
      data: {
        userId: newMerchant.id,
        storeName: 'New Store',
        category: 'Fashion',
        subCategory: 'Clothes',
        state: 'Lagos',
        city: 'Lagos',
        lga: 'Yaba',
        address: 'Test address',
        description: 'Test',
        logoUrl: 'https://example.com/logo.png',
        bankName: 'Test Bank',
        bankCode: '123',
        bankAccountNumber: '1234567890',
        bankAccountName: 'New Store',
      },
    });
    const vendors = new VendorsService(prisma);
    const dto = {
      representativeName: 'Test Merchant',
      representativeRole: 'CEO',
      sellerType: 'RETAILER' as const,
      termsAccepted: true as const,
    };
    const profile = await vendors.submitProfile(newMerchant.id, dto);
    const first = await billing.summary(newMerchant.id);
    expect(first.trialStartedAt).toEqual(profile.submittedAt);
    expect(first.trialEndsAt).toEqual(addMonths(first.trialStartedAt, 1));
    expect(first.canPay).toBe(false);
    await expect(billing.checkout(newMerchant.id)).rejects.toThrow(
      'not due yet',
    );
    await prisma.vendorProfile.update({
      where: { userId: newMerchant.id },
      data: { submittedAt: null, setupCompleted: false },
    });
    await vendors.submitProfile(newMerchant.id, dto);
    expect((await billing.summary(newMerchant.id)).trialStartedAt).toEqual(
      first.trialStartedAt,
    );
  });
  it('serves authenticated web APIs and validates raw-body webhook signatures over HTTP', async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret })],
      controllers: [
        ReferralsController,
        ReferralInvitationsController,
        MerchantBillingController,
        ReferralPaymentWebhookController,
      ],
      providers: [
        { provide: ReferralsService, useValue: referrals },
        { provide: MerchantBillingService, useValue: billing },
      ],
    }).compile();
    const app = module.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    try {
      const jwt = module.get(JwtService),
        token = jwt.sign({ sub: owner });
      await request(app.getHttpServer())
        .get(`/users/${owner}/referrals/status`)
        .expect(401);
      await request(app.getHttpServer())
        .get(`/users/${merchant}/referrals/status`)
        .auth(token, { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer())
        .get(`/users/${owner}/referrals/status?page=0`)
        .auth(token, { type: 'bearer' })
        .expect(400);
      const overview = await request(app.getHttpServer())
        .get(`/users/${owner}/referrals?compact=true`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(overview.body.referrals).toEqual([]);
      expect(overview.body.summary.totalRewards).toBe(15000);
      await request(app.getHttpServer())
        .get(`/users/${owner}/referrals/status?status=PENDING&q=Historical`)
        .auth(token, { type: 'bearer' })
        .expect(200)
        .expect((response) => expect(response.body.total).toBe(1));
      await request(app.getHttpServer())
        .get('/referrals/invitations/test-referral-invitation')
        .expect(200);
      await request(app.getHttpServer())
        .get('/referrals/invitations/invalid')
        .expect(404);
      const raw =
        '{ "event": "charge.success", "data": { "reference": "shopping-order" } }';
      await request(app.getHttpServer())
        .post('/payments/paystack/webhook')
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(401);
      await request(app.getHttpServer())
        .post('/payments/paystack/webhook')
        .set('Content-Type', 'application/json')
        .set(
          'x-paystack-signature',
          createHmac('sha512', secret).update(raw).digest('hex'),
        )
        .send(raw)
        .expect(200);
    } finally {
      await app.close();
    }
  });
});
