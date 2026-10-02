import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { resolve } from 'node:path';
import { AppModule } from '../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OTP_PROVIDER } from '../auth/otp/otp.provider';

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
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=',
      'base64',
    );
    beforeAll(async () => {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(OTP_PROVIDER)
        .useValue({
          sendOtp: async (number: string, code: string) => {
            codes.set(number, code);
          },
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
      app.useStaticAssets(resolve(process.env.UPLOAD_DIR ?? 'uploads'), {
        prefix: '/uploads/',
      });
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
      expect(verified.body.verified).toBe(true);
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ phone, registrationType: 'SELLER' })
        .expect(201);
      token = registered.body.accessToken;
      userId = registered.body.user.id;
      expect(token).toBeTruthy();
      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(me.body.registrationType).toBe('SELLER');
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
      expect(saved.body.id).toBeTruthy();
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
      expect(submitted.body.setupCompleted).toBe(true);
      const restored = await request(app.getHttpServer())
        .get(`/vendors/${userId}/profile`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(restored.body.storeName).toBe(details.storeName);
      expect(restored.body.bankAccountNumber).toBe('0123456789');
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
      productId = response.body.id;
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: response.body.id },
      });
      expect(product).toMatchObject({
        name: 'Verification wristwatch',
        quantity: 3,
        unitPrice: 134000,
        promoPrice: 110000,
        specifications: { Style: 'Classic' },
      });
      await request(app.getHttpServer()).get(product.imageUrls[0]).expect(200);
      const publicStore = await request(app.getHttpServer())
        .get(`/vendors/${userId}/storefront`)
        .expect(200);
      expect(publicStore.body.profile.bankAccountNumber).toBeUndefined();
      expect(publicStore.body.profile.cacUrl).toBeUndefined();
      expect(
        publicStore.body.products.some(
          (item: { id: string }) => item.id === product.id,
        ),
      ).toBe(true);
      const marketplace = await request(app.getHttpServer())
        .get('/buyer/marketplace')
        .expect(200);
      expect(JSON.stringify(marketplace.body)).toContain(product.id);
      expect(JSON.stringify(marketplace.body)).toContain(userId);
    });
    it('persists a seller feature, exposes it to buyers, and rejects another store product', async () => {
      const selected = await request(app.getHttpServer())
        .patch(`/vendors/${userId}/storefront`)
        .auth(token, { type: 'bearer' })
        .send({ featuredProductId: productId })
        .expect(200);
      expect(selected.body.featuredProductId).toBe(productId);
      const marketplace = await request(app.getHttpServer())
        .get('/buyer/marketplace')
        .expect(200);
      expect(
        marketplace.body.vendors.find((v: { id: string }) => v.id === userId)
          .featuredProductId,
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
    it('persists notification reads and settings and isolates notification ownership', async () => {
      await request(app.getHttpServer())
        .get('/seller/notifications')
        .expect(401);
      const feed = await request(app.getHttpServer())
        .get('/seller/notifications?type=inventory')
        .auth(token, { type: 'bearer' })
        .expect(200);
      const notice = feed.body.notifications.find(
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
        restored.body.notifications.find(
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
      expect(settings.body.inventoryAlerts).toBe(false);
      const disabled = await request(app.getHttpServer())
        .get('/seller/notifications?type=inventory')
        .auth(token, { type: 'bearer' })
        .expect(200);
      expect(disabled.body.notifications).toHaveLength(0);
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
      expect(readAll.body.unreadCount).toBe(0);
    });
  },
);
