import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { AppModule } from '../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OTP_PROVIDER } from '../auth/otp/otp.provider';

// The HTTP assertions below verify the required fields from these JSON responses.
type TestPayload = {
  id: string;
  verified: boolean;
  accessToken: string;
  user: { id: string };
  registrationType: string;
  setupCompleted: boolean;
  profile: {
    userId: string;
    storeName: string;
    bankAccountNumber?: string;
    about: string;
  };
  products: { id: string; salesCount: number }[];
  categories: { name: string; productCount: number }[];
  featuredProductId: string;
  vendors: { id: string; featuredProductId: string }[];
  total: number;
  trustees: { id: string; reviewerName: string }[];
  reviews: {
    rating: number | null;
    helpfulCount: number;
    notHelpfulCount: number;
    viewerVote: boolean | null;
  }[];
  notifications: { id: string; productId: string; read: boolean }[];
  inventoryAlerts: boolean;
  unreadCount: number;
};
function payload(response: { body: unknown }): TestPayload {
  return response.body as TestPayload;
}

// This integration suite can only run against the explicitly isolated local database.
const isolated =
  /^postgresql:\/\/[^@]+@localhost:5433\/seller_web_verification(?:\?|$)/.test(
    process.env.DATABASE_URL ?? '',
  );
(isolated ? describe : describe.skip)(
  'Seller web journey with PostgreSQL',
  () => {
    jest.setTimeout(60000);
    let app: NestExpressApplication;
    let prisma: PrismaService;
    const codes = new Map<string, string>();
    const phone = `+23480${String(Date.now()).slice(-8)}`;
    let userId: string;
    let token: string;
    let productId: string;

    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=',
      'base64',
    );
    beforeAll(async () => {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(OTP_PROVIDER)
        .useValue({
          sendOtp: (number: string) => {
            codes.set(number, '123456');
            return Promise.resolve({ pinId: 'isolated-verification-pin' });
          },
          verifyOtp: (_pinId: string, code: string) =>
            Promise.resolve(code === '123456'),
        })
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
      prisma = module.get(PrismaService);
    }, 60000);
    afterAll(async () => {
      if (app) await app.close();
    });

    it('verifies phone, creates a seller and restores the session', async () => {
      await request(app.getHttpServer())
        .post('/auth/phone/send-otp')
        .send({ phone })
        .expect(201);
      const verified = await request(app.getHttpServer())
        .post('/auth/phone/verify-otp')
        .send({ phone, code: codes.get(phone) })
        .expect(201);
      expect(payload(verified).verified).toBe(true);
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ phone, registrationType: 'SELLER' })
        .expect(201);
      token = payload(registered).accessToken;
      userId = payload(registered).user.id;
      expect(token).toBeTruthy();
      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(payload(me).registrationType).toBe('SELLER');
    });
    it('protects setup writes and persists profile, identity, bank and submission', async () => {
      const details = {
        storeName: 'Seller web verification store',
        category: 'Fashion & Accessories',
        subCategory: 'Jewellery',
        state: 'Lagos',
        city: 'Ikeja',
        lga: 'Ikeja',
        address: '1 Verification Road',
        description: 'Store used for local verification only',
      };
      await request(app.getHttpServer())
        .put(`/vendors/${userId}/profile`)
        .send(details)
        .expect(401);
      await request(app.getHttpServer())
        .put('/vendors/another-user/profile')
        .auth(token, { type: 'bearer' })
        .send(details)
        .expect(403);
      const saved = await request(app.getHttpServer())
        .put(`/vendors/${userId}/profile`)
        .auth(token, { type: 'bearer' })
        .send(details)
        .expect(200);
      expect(payload(saved).id).toBeTruthy();
      await request(app.getHttpServer())
        .post(`/vendors/${userId}/submit`)
        .auth(token, { type: 'bearer' })
        .send({ sellerType: 'RETAILER', termsAccepted: true })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/vendors/${userId}/identity`)
        .auth(token, { type: 'bearer' })
        .attach('logo', image, {
          filename: 'logo.png',
          contentType: 'image/png',
        })
        .expect(201);
      await request(app.getHttpServer())
        .put(`/vendors/${userId}/bank`)
        .auth(token, { type: 'bearer' })
        .send({
          bankName: 'Access Bank',
          bankCode: '000014',
          accountNumber: '0123456789',
          accountName: 'Local Verification',
        })
        .expect(200);
      const submitted = await request(app.getHttpServer())
        .post(`/vendors/${userId}/submit`)
        .auth(token, { type: 'bearer' })
        .send({ sellerType: 'RETAILER', termsAccepted: true })
        .expect(201);
      expect(payload(submitted).setupCompleted).toBe(true);
      const restored = await request(app.getHttpServer())
        .get(`/vendors/${userId}/profile`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(payload(restored).storeName).toBe(details.storeName);
      expect(payload(restored).bankAccountNumber).toBe('0123456789');
    });
    it('publishes full multipart product data and proves persistence and public discovery', async () => {
      const response = await request(app.getHttpServer())
        .post(`/vendors/${userId}/products`)
        .auth(token, { type: 'bearer' })
        .field('category', 'Watches')
        .field('mainCategory', 'Fashion & Accessories')
        .field('subCategories', JSON.stringify(['Jewellery', 'Watches']))
        .field('name', 'Verification wristwatch')
        .field('description', 'Leather watch with quartz movement')
        .field('unitPrice', '134000')
        .field('quantity', '3')
        .field('promoPrice', '110000')
        .field('promoDurationHours', '24')
        .field('specifications', JSON.stringify({ Style: 'Classic' }))
        .field(
          'variants',
          JSON.stringify([{ color: 'White', size: 'XL', quantity: 3 }]),
        )
        .attach('images', image, {
          filename: 'watch.png',
          contentType: 'image/png',
        })
        .expect(201);
      productId = payload(response).id;
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: payload(response).id },
      });
      expect(product).toMatchObject({
        name: 'Verification wristwatch',
        quantity: 3,
        unitPrice: 134000,
        promoPrice: 110000,
        specifications: { Style: 'Classic' },
      });
      expect(product.imageUrls[0]).toMatch(/^https:\/\/res\.cloudinary\.com\//);
      expect((await fetch(product.imageUrls[0])).ok).toBe(true);
      const publicStore = await request(app.getHttpServer())
        .get(`/vendors/${userId}/storefront`)
        .expect(200);
      expect(payload(publicStore).profile.bankAccountNumber).toBeUndefined();
      expect(payload(publicStore).profile.cacUrl).toBeUndefined();
      expect(
        payload(publicStore).products.some(
          (item: { id: string }) => item.id === product.id,
        ),
      ).toBe(true);
      const marketplace = await request(app.getHttpServer())
        .get('/buyer/marketplace')
        .expect(200);
      expect(JSON.stringify(payload(marketplace))).toContain(product.id);
      expect(JSON.stringify(payload(marketplace))).toContain(userId);
    });
    it('persists a seller feature, exposes it to buyers, and rejects another store product', async () => {
      const selected = await request(app.getHttpServer())
        .patch(`/vendors/${userId}/storefront`)
        .auth(token, { type: 'bearer' })
        .send({ featuredProductId: productId })
        .expect(200);
      expect(payload(selected).featuredProductId).toBe(productId);
      const marketplace = await request(app.getHttpServer())
        .get('/buyer/marketplace')
        .expect(200);
      expect(
        payload(marketplace).vendors.find(
          (v: { id: string }) => v.id === userId,
        ).featuredProductId,
      ).toBe(productId);
      await request(app.getHttpServer())
        .patch(`/vendors/${userId}/storefront`)
        .auth(token, { type: 'bearer' })
        .send({ featuredProductId: '00000000-0000-4000-8000-000000000000' })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/vendors/another-user/storefront')
        .auth(token, { type: 'bearer' })
        .send({ featuredProductId: productId })
        .expect(403);
    });
    it('derives categories, persists About and keeps owner-only products private', async () => {
      const url = `/vendors/${userId}`;
      await request(app.getHttpServer())
        .get(`${url}/manage-storefront`)
        .expect(401);
      await request(app.getHttpServer())
        .post(`${url}/categories`)
        .auth(token, { type: 'bearer' })
        .send({ name: 'Manual category' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`${url}/storefront`)
        .auth(token, { type: 'bearer' })
        .send({ about: 'Quality watches for everyday wear.' })
        .expect(200);
      const saved = await request(app.getHttpServer())
        .get(`${url}/manage-storefront`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(payload(saved).profile.about).toBe(
        'Quality watches for everyday wear.',
      );
      expect(payload(saved).categories.length).toBeGreaterThan(0);
      await request(app.getHttpServer())
        .patch(`${url}/storefront`)
        .auth(token, { type: 'bearer' })
        .send({ about: 'a'.repeat(301) })
        .expect(400);
      await request(app.getHttpServer())
        .post(`${url}/products/${productId}/archive`)
        .auth(token, { type: 'bearer' })
        .expect(201);
      const publicView = await request(app.getHttpServer())
        .get(`${url}/storefront`)
        .expect(200);
      expect(
        payload(publicView).products.some(
          (product: { id: string }) => product.id === productId,
        ),
      ).toBe(false);
      const ownerView = await request(app.getHttpServer())
        .get(`${url}/manage-storefront`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(
        payload(ownerView).products.some(
          (product: { id: string }) => product.id === productId,
        ),
      ).toBe(true);
      expect(payload(ownerView).categories).toHaveLength(0);
      await request(app.getHttpServer())
        .post(`${url}/products/${productId}/activate`)
        .auth(token, { type: 'bearer' })
        .expect(201);
    });

    it('serves rated reviews, unique paged trustees and persistent helpful votes', async () => {
      const profile = await prisma.vendorProfile.findUniqueOrThrow({
        where: { userId },
      });
      const buyer = await prisma.user.create({
        data: {
          firstName: 'Ada',
          lastName: 'Local review',
          city: 'Yaba',
          state: 'Lagos',
          registrationType: 'BUYER',
        },
      });
      const buyerToken = app.get(JwtService).sign({ sub: buyer.id });
      const order = await prisma.commerceOrder.create({
        data: {
          userId: buyer.id,
          deliveryAddress: 'Test address',
          latitude: 6.5,
          longitude: 3.3,
          paymentMethod: 'wallet',
          status: 'delivered',
          subtotal: 20000,
          serviceFee: 0,
          deliveryFee: 0,
          total: 20000,
          items: {
            create: {
              productId,
              vendorId: userId,
              vendorName: profile.storeName,
              name: 'Watch',
              subtitle: 'Local review test',
              imageUri: '',
              sku: 'TEST',
              unitPrice: 20000,
              quantity: 1,
              deliveryAddress: 'Test address',
            },
          },
        },
      });
      const created = await request(app.getHttpServer())
        .post('/buyer/trust-reviews')
        .auth(buyerToken, { type: 'bearer' })
        .send({
          orderId: order.id,
          vendorId: userId,
          reason: 'Reliable delivery and quality watches.',
          rating: 4,
        })
        .expect(201);
      const reviewId = payload(created).id;
      // A second reviewed order from the same buyer must not create a second trustee.
      const secondOrder = await prisma.commerceOrder.create({
        data: {
          userId: buyer.id,
          deliveryAddress: 'Test address',
          latitude: 6.5,
          longitude: 3.3,
          paymentMethod: 'wallet',
          status: 'delivered',
          subtotal: 1000,
          serviceFee: 0,
          deliveryFee: 0,
          total: 1000,
        },
      });
      await prisma.vendorTrustReview.create({
        data: {
          reviewerUserId: buyer.id,
          vendorProfileId: profile.id,
          orderId: secondOrder.id,
          reason: 'Another excellent purchase.',
          rating: 5,
        },
      });
      const trustees = await request(app.getHttpServer())
        .get(`/vendors/${userId}/trustees?limit=1`)
        .expect(200);
      expect(payload(trustees).total).toBe(1);
      expect(payload(trustees).trustees).toHaveLength(1);
      const reviews = await request(app.getHttpServer())
        .get(`/vendors/${userId}/reviews?sort=highest&limit=1`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(payload(reviews).total).toBe(2);
      expect(payload(reviews).reviews[0].rating).toBe(5);
      const page = await request(app.getHttpServer())
        .get(`/vendors/${userId}/reviews?sort=highest&offset=1&limit=1`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(payload(page).reviews[0].rating).toBe(4);
      await request(app.getHttpServer())
        .post(`/vendors/${userId}/reviews/${reviewId}/vote`)
        .send({ helpful: true })
        .expect(401);
      await request(app.getHttpServer())
        .post(`/vendors/${userId}/reviews/${reviewId}/vote`)
        .auth(token, { type: 'bearer' })
        .send({ helpful: true })
        .expect(201);
      const restored = await request(app.getHttpServer())
        .get(`/vendors/${userId}/reviews?search=Reliable`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(payload(restored).reviews[0]).toMatchObject({
        helpfulCount: 1,
        viewerVote: true,
        rating: 4,
      });
      await request(app.getHttpServer())
        .post(`/vendors/${userId}/reviews/${reviewId}/vote`)
        .auth(token, { type: 'bearer' })
        .send({ helpful: false })
        .expect(201);
      const switched = await request(app.getHttpServer())
        .get(`/vendors/${userId}/reviews?search=Reliable`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(payload(switched).reviews[0]).toMatchObject({
        helpfulCount: 0,
        notHelpfulCount: 1,
        viewerVote: false,
      });
      await request(app.getHttpServer())
        .post(`/vendors/${userId}/reviews/${reviewId}/vote`)
        .auth(token, { type: 'bearer' })
        .send({ helpful: null })
        .expect(201);
      const cleared = await request(app.getHttpServer())
        .get(`/vendors/${userId}/reviews?search=Reliable`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(payload(cleared).reviews[0]).toMatchObject({
        helpfulCount: 0,
        notHelpfulCount: 0,
        viewerVote: null,
      });
      await request(app.getHttpServer())
        .get(`/vendors/${userId}/reviews?limit=1000`)
        .auth(token, { type: 'bearer' })
        .expect(400);
    });

    it('persists notification reads and settings and isolates notification ownership', async () => {
      await request(app.getHttpServer())
        .get('/seller/notifications')
        .expect(401);
      const feed = await request(app.getHttpServer())
        .get('/seller/notifications?type=inventory')
        .auth(token, { type: 'bearer' })
        .expect(200);
      const notice = payload(feed).notifications.find(
        (n: { productId: string }) => n.productId === productId,
      );
      expect(notice.read).toBe(false);
      await request(app.getHttpServer())
        .patch('/seller/notifications/read')
        .auth(token, { type: 'bearer' })
        .send({ ids: ['inventory:another-account'] })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/seller/notifications/read')
        .auth(token, { type: 'bearer' })
        .send({ ids: [notice.id] })
        .expect(200);
      const restored = await request(app.getHttpServer())
        .get('/seller/notifications')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(
        payload(restored).notifications.find(
          (n: { id: string }) => n.id === notice.id,
        ).read,
      ).toBe(true);
      await request(app.getHttpServer())
        .patch('/seller/notifications/settings')
        .auth(token, { type: 'bearer' })
        .send({ inventoryAlerts: false })
        .expect(200);
      const settings = await request(app.getHttpServer())
        .get('/seller/notifications/settings')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(payload(settings).inventoryAlerts).toBe(false);
      const disabled = await request(app.getHttpServer())
        .get('/seller/notifications?type=inventory')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(payload(disabled).notifications).toHaveLength(0);
      await request(app.getHttpServer())
        .patch('/seller/notifications/settings')
        .auth(token, { type: 'bearer' })
        .send({ inventoryAlerts: true })
        .expect(200);
      await request(app.getHttpServer())
        .post('/seller/notifications/read-all')
        .auth(token, { type: 'bearer' })
        .expect(201);
      const readAll = await request(app.getHttpServer())
        .get('/seller/notifications')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(payload(readAll).unreadCount).toBe(0);
    });
  },
);
