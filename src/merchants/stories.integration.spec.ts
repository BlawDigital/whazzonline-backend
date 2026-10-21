import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('./merchant-media', () => ({
  uploadStoryMusic: jest
    .fn()
    .mockResolvedValue({
      url: 'https://example.test/story.mp3',
      publicId: 'story-music',
    }),
  uploadMerchantMedia: jest.fn().mockResolvedValue({
    mediaUrl: 'https://example.test/story.png',
    mediaType: 'IMAGE',
    publicId: 'isolated-story',
    resourceType: 'image',
  }),
}));
jest.mock('../storage/cloudinary-storage', () => ({
  ...jest.requireActual<typeof import('../storage/cloudinary-storage')>(
    '../storage/cloudinary-storage',
  ),
  cloudinaryClient: () => ({
    uploader: { destroy: jest.fn().mockResolvedValue({}) },
  }),
}));
const isolated =
  /^postgresql:\/\/[^@]+@localhost:5433\/seller_web_verification(?:_notifications)?(?:\?|$)/.test(
    process.env.DATABASE_URL ?? '',
  );
(isolated ? describe : describe.skip)(
  'Merchant Stories HTTP persistence',
  () => {
    jest.setTimeout(60000);
    let app: NestExpressApplication, db: PrismaService;
    const seller = randomUUID(),
      buyer = randomUUID(),
      outsider = randomUUID();
    let sellerToken: string,
      buyerToken: string,
      outsiderToken: string,
      storyId: string;
    beforeAll(async () => {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
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
      db = module.get(PrismaService);
      const jwt = module.get(JwtService);
      [sellerToken, buyerToken, outsiderToken] = await Promise.all(
        [seller, buyer, outsider].map((sub) => jwt.signAsync({ sub })),
      );
      for (const id of [seller, buyer, outsider])
        await db.user.create({
          data: {
            id,
            firstName: 'Story fixture',
            registrationType: id === seller ? 'SELLER' : 'BUYER',
            role: id === seller ? 'VENDOR' : 'CUSTOMER',
          },
        });
      await db.vendorProfile.create({
        data: {
          userId: seller,
          storeName: 'Story verification store',
          category: 'Fashion',
          subCategory: 'Clothes',
          city: 'Lagos',
          state: 'Lagos',
          lga: 'Ikeja',
          address: 'Isolated test',
          description: 'Story fixture',
          setupCompleted: true,
          reviewStatus: 'APPROVED',
        },
      });
    });
    afterAll(async () => {
      if (db)
        await db.user.deleteMany({
          where: { id: { in: [seller, buyer, outsider] } },
        });
      await app?.close();
    });
    it('publishes media, exposes it on buyer and merchant Home, edits only as owner and deletes', async () => {
      const created = await request(app.getHttpServer())
        .post('/merchants/content')
        .auth(sellerToken, { type: 'bearer' })
        .field('kind', 'STORY')
        .field('title', 'New In')
        .field('topic', 'NEW_IN')
        .attach('music', Buffer.from('ID3test audio'), {
          filename: 'story.mp3',
          contentType: 'audio/mpeg',
        })
        .attach('media', Buffer.from('test image'), {
          filename: 'story.png',
          contentType: 'image/png',
        })
        .expect(201);
      storyId = (created.body as { id: string }).id;
      expect(
        await db.merchantContent.findUnique({ where: { id: storyId } }),
      ).toMatchObject({
        title: 'New In',
        kind: 'STORY',
        musicUrl: 'https://example.test/story.mp3',
      });
      for (const token of [buyerToken, sellerToken]) {
        const feed = await request(app.getHttpServer())
          .get(`/merchants/feed?kind=STORY&merchantId=${seller}`)
          .auth(token, { type: 'bearer' })
          .expect(200);
        expect((feed.body as { items: { id: string }[] }).items).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: storyId })]),
        );
      }
      const publicFeed = await request(app.getHttpServer())
        .get(`/merchants/stories?merchantId=${seller}`)
        .expect(200);
      expect((publicFeed.body as { items: { id: string }[] }).items[0].id).toBe(
        storyId,
      );
      await request(app.getHttpServer())
        .patch(`/merchants/content/${storyId}`)
        .auth(outsiderToken, { type: 'bearer' })
        .send({ title: 'Other store' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/merchants/content/${storyId}`)
        .auth(sellerToken, { type: 'bearer' })
        .send({ title: 'Trends', caption: 'Updated caption' })
        .expect(200);
      expect(
        await db.merchantContent.findUnique({ where: { id: storyId } }),
      ).toMatchObject({ title: 'Trends', caption: 'Updated caption' });
      await request(app.getHttpServer())
        .get('/auth/me')
        .auth(sellerToken, { type: 'bearer' })
        .expect(200)
        .expect((response) => {
          expect(response.body as unknown).toMatchObject({
            merchantStoreName: 'Story verification store',
          });
        });
      await db.merchantContent.update({
        where: { id: storyId },
        data: { createdAt: new Date(Date.now() - 86400001) },
      });
      const expired = await request(app.getHttpServer())
        .get(`/merchants/stories?merchantId=${seller}`)
        .expect(200);
      expect((expired.body as { items: unknown[] }).items).toHaveLength(0);
      await request(app.getHttpServer())
        .delete(`/merchants/content/${storyId}`)
        .auth(outsiderToken, { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/merchants/content/${storyId}`)
        .auth(sellerToken, { type: 'bearer' })
        .expect(200);
      expect(
        await db.merchantContent.findUnique({ where: { id: storyId } }),
      ).toBeNull();
    });
  },
);
