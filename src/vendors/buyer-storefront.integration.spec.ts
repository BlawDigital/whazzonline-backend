import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { VendorsService } from './vendors.service';
import { PrismaService } from '../../prisma/prisma.service';
import { isolatedInvoiceDatabase } from '../../test/helpers/isolated-invoice-database';

jest.setTimeout(240000);
const databaseTests =
  process.env.RUN_STOREFRONT_DATABASE_TESTS === '1' ? describe : describe.skip;
databaseTests('Buyer storefront and receipt HTTP persistence', () => {
  let db: PrismaService,
    cleanup: () => Promise<void>,
    app: NestExpressApplication;
  const buyer = randomUUID(),
    vendor = randomUUID();
  let buyerToken: string, vendorToken: string, orderId: string;
  const details = {
    heading: 'Our independent shop',
    representativeTitle: 'Founder & Creative Director',
    phone: '+234 812 345 6789',
    email: 'hello@example.com',
    handle: '@local_shop',
    businessHours: [
      { label: 'Mon - Fri', value: '9am - 7pm' },
      { label: 'Sunday', value: 'Closed' },
    ],
  };
  beforeAll(async () => {
    ({ prisma: db, cleanup } = await isolatedInvoiceDatabase());
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    const jwt = module.get(JwtService);
    buyerToken = await jwt.signAsync({ sub: buyer });
    vendorToken = await jwt.signAsync({ sub: vendor });
    await db.user.create({
      data: {
        id: buyer,
        firstName: 'Test buyer',
        role: 'CUSTOMER',
        registrationType: 'BUYER',
        isActive: true,
      },
    });
    await db.user.create({
      data: {
        id: vendor,
        firstName: 'Test merchant',
        role: 'VENDOR',
        registrationType: 'SELLER',
        isActive: true,
      },
    });
    const profile = await db.vendorProfile.create({
      data: {
        userId: vendor,
        storeName: 'Test store',
        category: 'Fashion',
        subCategory: 'Watches',
        state: 'Lagos',
        city: 'Yaba',
        lga: 'Yaba',
        address: 'Test address',
        description: 'Independent store for local testing',
        setupCompleted: true,
        reviewStatus: 'APPROVED',
      },
    });
    const product = await db.product.create({
      data: {
        vendorProfileId: profile.id,
        name: 'Watch',
        category: 'Watches',
        unitPrice: 100,
        quantity: 10,
        imageUrls: [],
        status: 'ACTIVE',
      },
    });
    const order = await db.commerceOrder.create({
      data: {
        userId: buyer,
        status: 'delivered',
        paymentStatus: 'paid',
        paymentMethod: 'wallet',
        completedAt: new Date('2026-10-24T12:00:00Z'),
        deliveryAddress: 'Test address',
        latitude: 6.5,
        longitude: 3.4,
        subtotal: 100,
        total: 100,
        serviceFee: 0,
        deliveryFee: 0,
        items: {
          create: [
            {
              productId: product.id,
              vendorId: vendor,
              vendorName: 'Test store',
              name: 'Watch',
              subtitle: '',
              imageUri: '',
              sku: 'test-watch',
              unitPrice: 100,
              quantity: 1,
              deliveryAddress: 'Test address',
            },
          ],
        },
        fulfillments: {
          create: [
            {
              vendorId: vendor,
              status: 'delivered',
              history: {
                create: {
                  status: 'delivered',
                  actorUserId: vendor,
                  reason: 'Merchant marked delivered',
                },
              },
            },
          ],
        },
      },
    });
    orderId = order.id;
  });
  it('preserves an approved storefront when updating its profile photo and cover', async () => {
    const service = app.get(VendorsService);
    await service.saveIdentity(vendor, {
      logoUrl: 'https://example.test/logo.jpg',
      bannerUrl: 'https://example.test/banner.jpg',
    });
    const profile = await db.vendorProfile.findUniqueOrThrow({
      where: { userId: vendor },
    });
    expect(profile).toMatchObject({
      setupCompleted: true,
      reviewStatus: 'APPROVED',
      logoUrl: 'https://example.test/logo.jpg',
      bannerUrl: 'https://example.test/banner.jpg',
    });
  });
  it('counts incoming messages and paid pending orders for the authenticated account', async () => {
    const profile = await db.vendorProfile.findUniqueOrThrow({
      where: { userId: vendor },
    });
    const conversation = await db.conversation.create({
      data: {
        buyerUserId: buyer,
        vendorProfileId: profile.id,
        messages: {
          create: {
            senderUserId: buyer,
            kind: 'TEXT',
            text: 'New buyer message',
          },
        },
      },
    });
    const before = await request(app.getHttpServer())
      .get('/buyer/conversations/activity')
      .auth(vendorToken, { type: 'bearer' })
      .expect(200);
    expect(before.body).toEqual({ unreadChats: 1, pendingOrders: 0 });
    await request(app.getHttpServer()).patch(`/buyer/conversations/${conversation.id}/favorite`).auth(vendorToken,{type:'bearer'}).send({favorite:true}).expect(200,{favorite:true});
    const vendorChats = await request(app.getHttpServer()).get('/buyer/conversations').auth(vendorToken,{type:'bearer'}).expect(200);
    expect(vendorChats.body.conversations.find((row:{id:string})=>row.id===conversation.id)).toMatchObject({favorite:true});
    expect(vendorChats.body.conversations[0].timestampLabel).toMatch(/\d+:\d{2}\s?(am|pm)/i);
    const buyerChats = await request(app.getHttpServer()).get('/buyer/conversations').auth(buyerToken,{type:'bearer'}).expect(200);
    expect(buyerChats.body.conversations.find((row:{id:string})=>row.id===conversation.id)).toMatchObject({favorite:false});
    await request(app.getHttpServer()).patch(`/buyer/conversations/${conversation.id}/favorite`).auth(vendorToken,{type:'bearer'}).send({favorite:'yes'}).expect(400);
    await request(app.getHttpServer()).patch(`/buyer/conversations/${randomUUID()}/favorite`).auth(buyerToken,{type:'bearer'}).send({favorite:true}).expect(404);
    const source = await db.commerceOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    const {
      id: _id,
      createdAt: _created,
      updatedAt: _updated,
      items,
      ...fields
    } = source;
    const {
      id: _itemId,
      orderId: _orderId,
      createdAt: _itemCreated,
      ...item
    } = items[0];
    const order = await db.commerceOrder.create({
      data: {
        ...fields,
        status: 'confirmed',
        completedAt: null,
        items: { create: item },
      },
    });
    const paid = await request(app.getHttpServer())
      .get('/buyer/conversations/activity')
      .auth(vendorToken, { type: 'bearer' })
      .expect(200);
    expect(paid.body).toEqual({ unreadChats: 1, pendingOrders: 1 });
    await request(app.getHttpServer())
      .get('/buyer/conversations/activity')
      .auth(buyerToken, { type: 'bearer' })
      .expect(200, { unreadChats: 0, pendingOrders: 0 });
    await request(app.getHttpServer())
      .post(`/buyer/conversations/${conversation.id}/read`)
      .auth(vendorToken, { type: 'bearer' })
      .expect(201);
    await db.sellerFulfillment.create({
      data: { orderId: order.id, vendorId: vendor, status: 'processing' },
    });
    await request(app.getHttpServer())
      .get('/buyer/conversations/activity')
      .auth(vendorToken, { type: 'bearer' })
      .expect(200, { unreadChats: 0, pendingOrders: 0 });
    await request(app.getHttpServer())
      .get('/buyer/conversations/activity')
      .expect(401);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (cleanup) await cleanup();
  });
  it('persists public About details and returns them without exposing private fields', async () => {
    await request(app.getHttpServer())
      .patch(`/vendors/${vendor}/storefront`)
      .auth(buyerToken, { type: 'bearer' })
      .send({ storefrontDetails: details })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/vendors/${vendor}/storefront`)
      .auth(vendorToken, { type: 'bearer' })
      .send({
        about: 'Our story, written by the store.',
        representativeName: 'Test founder',
        representativeRole: 'CEO',
        storefrontDetails: details,
      })
      .expect(200);
    const saved = await request(app.getHttpServer())
      .get(`/vendors/${vendor}/storefront`)
      .expect(200);
    expect(saved.body.profile.storefrontDetails).toEqual(details);
    expect(saved.body.profile.bankAccountNumber).toBeUndefined();
    const marketplace = await request(app.getHttpServer())
      .get('/buyer/marketplace')
      .expect(200);
    expect(
      marketplace.body.vendors.find(
        (item: { id: string }) => item.id === vendor,
      ).storefrontDetails,
    ).toEqual(details);
    await request(app.getHttpServer())
      .patch(`/vendors/${vendor}/storefront`)
      .auth(vendorToken, { type: 'bearer' })
      .send({ storefrontDetails: { email: 'invalid' } })
      .expect(400);
  });
  it('saves and removes a merchant contact independently of trustee status', async () => {
    await request(app.getHttpServer())
      .post(`/merchants/${vendor}/contact`)
      .auth(buyerToken, { type: 'bearer' })
      .expect(201);
    const saved = await request(app.getHttpServer())
      .get('/merchants/contacts')
      .auth(buyerToken, { type: 'bearer' })
      .expect(200);
    expect(saved.body.merchantIds).toContain(vendor);
    await request(app.getHttpServer())
      .delete(`/merchants/${vendor}/contact`)
      .auth(buyerToken, { type: 'bearer' })
      .expect(200);
    const removed = await request(app.getHttpServer())
      .get('/merchants/contacts')
      .auth(buyerToken, { type: 'bearer' })
      .expect(200);
    expect(removed.body.merchantIds).not.toContain(vendor);
  });
  it('keeps buyer confirmation separate from merchant delivery and persists it through retries and cart reloads', async () => {
    const cartBefore = await request(app.getHttpServer())
      .get('/buyer/cart')
      .auth(buyerToken, { type: 'bearer' })
      .expect(200);
    expect(
      cartBefore.body.completedOrders.find(
        (order: { id: string }) => order.id === orderId,
      ).buyerConfirmedAt,
    ).toBeUndefined();
    const confirmed = await request(app.getHttpServer())
      .patch(`/buyer/orders/${orderId}`)
      .auth(buyerToken, { type: 'bearer' })
      .expect(200);
    expect(confirmed.body.buyerConfirmedAt).toBeTruthy();
    expect(confirmed.body.completedAt).toBe('2026-10-24T12:00:00.000Z');
    const retry = await request(app.getHttpServer())
      .patch(`/buyer/orders/${orderId}`)
      .auth(buyerToken, { type: 'bearer' })
      .expect(200);
    expect(retry.body.buyerConfirmedAt).toBe(confirmed.body.buyerConfirmedAt);
    const cart = await request(app.getHttpServer())
      .get('/buyer/cart')
      .auth(buyerToken, { type: 'bearer' })
      .expect(200);
    const row = cart.body.completedOrders.find(
      (order: { id: string }) => order.id === orderId,
    );
    expect(row.buyerConfirmedAt).toBe(confirmed.body.buyerConfirmedAt);
    expect(row.reviewableVendorIds).toEqual([vendor]);
    await request(app.getHttpServer())
      .post('/buyer/trust-reviews')
      .auth(buyerToken, { type: 'bearer' })
      .send({
        orderId,
        vendorId: vendor,
        reason: 'Added after confirming receipt of my order.',
      })
      .expect(201);
    const updated = await request(app.getHttpServer())
      .get('/buyer/cart')
      .auth(buyerToken, { type: 'bearer' })
      .expect(200);
    expect(
      updated.body.completedOrders.find(
        (order: { id: string }) => order.id === orderId,
      ).trustedVendorIds,
    ).toEqual([vendor]);
  });
});
