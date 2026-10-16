import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { isolatedInvoiceDatabase } from '../../test/helpers/isolated-invoice-database';
import { OTP_PROVIDER } from './otp/otp.provider';
import { EMAIL_OTP_PROVIDER } from './otp/email-otp.provider';

const databaseTests =
  process.env.RUN_WEBAPP_DATABASE_TESTS === '1' ? describe : describe.skip;
databaseTests('registered accounts across the complete web API', () => {
  jest.setTimeout(180000);
  let app: INestApplication<Server>;
  let db: PrismaService;
  let cleanup: () => Promise<void>;
  const originalSecret = process.env.JWT_SECRET;
  const password = 'Isolated-test-password-123';
  type Account = { accessToken: string; user: { id: string; email?: string } };
  let buyer: Account;
  let seller: Account;
  const emailCodes = new Map<string, string>();
  const smsCodes = new Map<string, string>();
  let productId: string;
  beforeAll(async () => {
    const database = await isolatedInvoiceDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
    process.env.JWT_SECRET = 'isolated-webapp-integration-test-secret';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(EMAIL_OTP_PROVIDER)
      .useValue({
        sendOtp: (email: string, code: string) => {
          emailCodes.set(email, code);
          return Promise.resolve();
        },
      })
      .overrideProvider(OTP_PROVIDER)
      .useValue({
        sendOtp: () => {
          const pinId = randomUUID();
          smsCodes.set(pinId, '654321');
          return Promise.resolve({ pinId });
        },
        verifyOtp: (pinId: string, code: string) =>
          Promise.resolve(smsCodes.get(pinId) === code),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    buyer = (
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `${randomUUID()}@example.test`,
          password,
          registrationType: 'BUYER',
        })
        .expect(201)
    ).body as Account;
    seller = (
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ phone: '+2348031234567', password, registrationType: 'SELLER' })
        .expect(201)
    ).body as Account;
    const profile = await db.vendorProfile.create({
      data: {
        userId: seller.user.id,
        storeName: 'Webapp test store',
        setupCompleted: true,
        city: 'Ikeja',
        state: 'Lagos',
        lga: 'Ikeja',
        address: 'Test street',
        category: 'Fashion',
        subCategory: 'Watches',
        description: 'Local test store',
        bankName: 'Test bank',
        bankAccountName: 'Test store',
        bankAccountNumber: '1234567890',
      },
    });
    productId = (
      await db.product.create({
        data: {
          vendorProfileId: profile.id,
          name: 'Test watch',
          category: 'Fashion',
          unitPrice: 10000,
          quantity: 10,
          imageUrls: [],
        },
      })
    ).id;
    await db.interest.create({ data: { name: 'Fashion', slug: 'fashion' } });
  });
  afterAll(async () => {
    if (app) await app.close();
    if (cleanup) await cleanup();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });
  const api = () => request(app.getHttpServer());
  const bearer = (account: { accessToken: string }) =>
    `Bearer ${account.accessToken}`;
  it('uses the newly registered identity for current user and every profile step', async () => {
    const current = await api()
      .get('/auth/me')
      .set('Authorization', bearer(buyer))
      .expect(200);
    expect(current.body).toMatchObject({
      id: buyer.user.id,
      role: 'CUSTOMER',
      firstName: null,
      state: null,
      city: null,
    });
    await api()
      .patch('/auth/me/profile')
      .set('Authorization', bearer(buyer))
      .send({
        firstName: 'Ada',
        lastName: 'Test',
        state: 'Abia',
        city: 'Aba',
        interests: ['fashion'],
      })
      .expect(200);
    const updated = await api()
      .get('/auth/me')
      .set('Authorization', bearer(buyer))
      .expect(200);
    expect(updated.body).toMatchObject({
      firstName: 'Ada',
      state: 'Abia',
      city: 'Aba',
      emailVerified: true,
    });
    const interests = await api()
      .get('/interests/me')
      .set('Authorization', bearer(buyer))
      .expect(200);
    expect(interests.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: 'fashion', isSelected: true }),
      ]),
    );
  });
  it('opens seller offers and creates the exact JSON used by the web wizard', async () => {
    await api()
      .get(`/vendors/${seller.user.id}/manage-storefront`)
      .set('Authorization', bearer(seller))
      .expect(200);
    await api()
      .get(`/vendors/${seller.user.id}/offers`)
      .set('Authorization', bearer(seller))
      .expect(200);
    const created = await api()
      .post(`/vendors/${seller.user.id}/offers`)
      .set('Authorization', bearer(seller))
      .send({
        type: 'PRICE_DISCOUNT',
        productIds: [productId],
        durationHours: 24,
        name: 'Test watch offer',
        description: 'Created from a registered account',
        mediaUrls: [],
        intent: 'PUBLISH',
        requestId: randomUUID(),
        discountType: 'PERCENTAGE',
        discountValue: 20,
      })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'ACTIVE',
      name: 'Test watch offer',
    });
    await api()
      .post(`/merchants/${seller.user.id}/contact`)
      .set('Authorization', bearer(buyer))
      .expect(201);
    const saved = await api()
      .get('/merchants/offers')
      .set('Authorization', bearer(buyer))
      .expect(200);
    expect(saved.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: (created.body as { id: string }).id }),
      ]),
    );
    await api()
      .get('/merchants/offers/explore')
      .set('Authorization', bearer(buyer))
      .expect(200);
  });
  it('opens buying, adds a real product and creates an order without external payment calls', async () => {
    await api()
      .get('/buyer/cart')
      .set('Authorization', bearer(buyer))
      .expect(200);
    await api()
      .post('/buyer/cart')
      .set('Authorization', bearer(buyer))
      .send({
        productId,
        quantity: 1,
        deliveryAddress: 'Test street, Ikeja, Lagos',
      })
      .expect(201);
    const checkout = await api()
      .post('/buyer/checkout')
      .set('Authorization', bearer(buyer))
      .send({
        address: {
          label: 'Test street, Ikeja, Lagos',
          latitude: 6.6,
          longitude: 3.3,
        },
        paymentMethod: 'pay_on_delivery',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    expect(checkout.body).toBeDefined();
    await api()
      .get('/buyer/cart')
      .set('Authorization', bearer(buyer))
      .expect(200);
    await api()
      .get('/buyer/conversations')
      .set('Authorization', bearer(buyer))
      .expect(200);
  });

  it('recovers an email password only after verification and consumes the code once', async () => {
    const email = buyer.user.email!;
    const known = await api()
      .post('/auth/password-reset/request')
      .send({ email })
      .expect(201);
    const unknown = await api()
      .post('/auth/password-reset/request')
      .send({ email: 'missing@example.test' })
      .expect(201);
    expect(unknown.body).toEqual(known.body);
    const code = emailCodes.get(email)!;
    expect(code).toMatch(/^\d{6}$/);
    await api()
      .post('/auth/password-reset/update')
      .send({ email, code, password: 'Replacement-123' })
      .expect(400);
    await api()
      .post('/auth/password-reset/verify')
      .send({ email, code: '000000' })
      .expect(400);
    await api()
      .post('/auth/password-reset/verify')
      .send({ email, code })
      .expect(201);
    await api()
      .post('/auth/password-reset/update')
      .send({ email, code, password: 'Replacement-123' })
      .expect(201);
    await api()
      .post('/auth/password-reset/update')
      .send({ email, code, password: 'Replay-password-123' })
      .expect(400);
    await api().post('/auth/login').send({ email, password }).expect(401);
    await api()
      .post('/auth/login')
      .send({ email, password: 'Replacement-123' })
      .expect(201);
  });

  it('recovers a phone-only account by SMS, normalizes local numbers and blocks replay', async () => {
    const phone = '08031234567';
    await api()
      .post('/auth/password-reset/request')
      .send({ phone })
      .expect(201);
    await api()
      .post('/auth/password-reset/update')
      .send({ phone, code: '654321', password: 'Phone-replacement-123' })
      .expect(400);
    await api()
      .post('/auth/password-reset/verify')
      .send({ phone, code: '000000' })
      .expect(400);
    await api()
      .post('/auth/password-reset/verify')
      .send({ phone, code: '654321' })
      .expect(201);
    await api()
      .post('/auth/password-reset/update')
      .send({ phone, code: '654321', password: 'Phone-replacement-123' })
      .expect(201);
    await api()
      .post('/auth/password-reset/update')
      .send({ phone, code: '654321', password: 'Replay-password-123' })
      .expect(400);
    await api().post('/auth/login').send({ phone, password }).expect(401);
    await api()
      .post('/auth/login')
      .send({ phone, password: 'Phone-replacement-123' })
      .expect(201);
  });

  it('rejects ambiguous contacts, expired codes and an exhausted attempt limit', async () => {
    await api().post('/auth/password-reset/request').send({}).expect(400);
    await api()
      .post('/auth/password-reset/request')
      .send({ phone: '+2348031234567', email: buyer.user.email })
      .expect(400);
    const phone = '+2348031234567';
    await api()
      .post('/auth/password-reset/request')
      .send({ phone })
      .expect(201);
    await db.phoneOtp.updateMany({
      where: { phone, purpose: 'PASSWORD_RESET', consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await api()
      .post('/auth/password-reset/verify')
      .send({ phone, code: '654321' })
      .expect(400);
    await api()
      .post('/auth/password-reset/request')
      .send({ phone })
      .expect(201);
    for (let i = 0; i < 5; i++)
      await api()
        .post('/auth/password-reset/verify')
        .send({ phone, code: '000000' })
        .expect(400);
    await api()
      .post('/auth/password-reset/verify')
      .send({ phone, code: '654321' })
      .expect(400);
  });
});
