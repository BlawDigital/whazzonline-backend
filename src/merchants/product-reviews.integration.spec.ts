import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../prisma/prisma.service';
import { isolatedInvoiceDatabase } from '../../test/helpers/isolated-invoice-database';
import { MerchantService } from './merchant.service';
import {
  MerchantController,
  MerchantPublicController,
} from './merchant.controller';
import { uploadMerchantMedia } from './merchant-media';
jest.mock('./merchant-media', () => ({ uploadMerchantMedia: jest.fn() }));
const databaseTests =
  process.env.RUN_REVIEW_DATABASE_TESTS === '1' ? describe : describe.skip;
type ReviewFeed = Awaited<ReturnType<MerchantService['reviews']>>;
type SavedReview = Awaited<ReturnType<MerchantService['review']>>;
jest.setTimeout(180000);
databaseTests('product reviews: real persistence and HTTP boundaries', () => {
  let prisma: PrismaService,
    cleanup: () => Promise<void>,
    app: INestApplication<Server>,
    jwt: JwtService,
    service: MerchantService;
  let merchant: string,
    buyer: string,
    secondBuyer: string,
    visitor: string,
    product: string,
    otherProduct: string,
    review: string;
  const secret = 'isolated-product-review-test';
  const auth = (id: string) => `Bearer ${jwt.sign({ sub: id })}`;
  const url = () => `/merchants/products/${product}/reviews`;
  beforeAll(async () => {
    const db = await isolatedInvoiceDatabase();
    prisma = db.prisma;
    cleanup = db.cleanup;
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ global: true, secret })],
      controllers: [MerchantController, MerchantPublicController],
      providers: [
        MerchantService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    jwt = module.get(JwtService);
    service = module.get(MerchantService);
    const users = await Promise.all(
      ['Merchant', 'Ada', 'John', 'Visitor'].map((firstName) =>
        prisma.user.create({
          data: {
            firstName,
            email: `${firstName.toLowerCase()}@review-test.example`,
            isActive: true,
            isVerified: true,
            ...(firstName === 'Merchant'
              ? { role: 'VENDOR', registrationType: 'SELLER' }
              : {}),
          },
        }),
      ),
    );
    [merchant, buyer, secondBuyer, visitor] = users.map((u) => u.id);
    const profile = await prisma.vendorProfile.create({
      data: {
        userId: merchant,
        storeName: 'Review test store',
        setupCompleted: true,
        category: 'Fashion',
        subCategory: 'Clothes',
        state: 'Lagos',
        city: 'Lagos',
        lga: 'Yaba',
        address: 'Test store',
        description: 'Review test',
      },
    });
    const products = await Promise.all(
      ['Leather bag', 'Watch'].map((name) =>
        prisma.product.create({
          data: {
            vendorProfileId: profile.id,
            category: 'Fashion',
            name,
            unitPrice: 2500,
            quantity: 10,
            imageUrls: [],
          },
        }),
      ),
    );
    [product, otherProduct] = products.map((p) => p.id);
    for (const userId of [buyer, secondBuyer])
      await prisma.commerceOrder.create({
        data: {
          userId,
          deliveryAddress: 'Test buyer delivery',
          latitude: 6.5,
          longitude: 3.3,
          paymentMethod: 'bank',
          paymentStatus: 'paid',
          status: 'delivered',
          subtotal: 2500,
          deliveryFee: 0,
          serviceFee: 0,
          total: 2500,
          items: {
            create: {
              productId: product,
              vendorId: merchant,
              vendorName: 'Review test store',
              name: 'Leather bag',
              subtitle: '',
              imageUri: '',
              sku: 'TEST-BAG',
              unitPrice: 2500,
              quantity: 1,
              deliveryAddress: 'Test buyer delivery',
            },
          },
        },
      });
  }, 240000);
  afterAll(async () => {
    if (app) await app.close();
    if (cleanup) await cleanup();
  });
  it('requires delivered ownership, authenticates writes, and refuses merchant self-reviews', async () => {
    const body = { rating: 5, comment: 'Great leather bag' };
    await request(app.getHttpServer()).post(url()).send(body).expect(401);
    await request(app.getHttpServer())
      .post(url())
      .set('Authorization', auth(visitor))
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post(url())
      .set('Authorization', auth(merchant))
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post(url())
      .set('Authorization', auth(buyer))
      .send({ ...body, rating: 9 })
      .expect(400);
    const response = await request(app.getHttpServer())
      .post(url())
      .set('Authorization', auth(buyer))
      .send(body)
      .expect(201);
    review = (response.body as SavedReview).id;
    expect((await service.reviewViewer(buyer, product)).canReview).toBe(true);
    expect((await service.reviewViewer(merchant, product)).isOwner).toBe(true);
    expect((await service.reviewViewer(visitor, product)).canReview).toBe(
      false,
    );
  });
  it('returns real rating distributions, search, sorting and pagination without private user fields', async () => {
    await service.review(secondBuyer, product, {
      rating: 2,
      comment: 'Delivery was slow but a durable bag',
    });
    const first = await request(app.getHttpServer())
      .get(url() + '?limit=1&sort=highest')
      .expect(200);
    expect((first.body as ReviewFeed).total).toBe(2);
    expect((first.body as ReviewFeed).average).toBe(3.5);
    expect((first.body as ReviewFeed).distribution).toEqual({ '5': 1, '2': 1 });
    expect((first.body as ReviewFeed).hasMore).toBe(true);
    expect((first.body as ReviewFeed).items[0].rating).toBe(5);
    expect((first.body as ReviewFeed).items[0].user).not.toHaveProperty(
      'email',
    );
    const second = await request(app.getHttpServer())
      .get(url() + '?limit=1&offset=1&sort=highest')
      .expect(200);
    expect((second.body as ReviewFeed).items[0].rating).toBe(2);
    expect((second.body as ReviewFeed).hasMore).toBe(false);
    const search = await request(app.getHttpServer())
      .get(url() + '?search=durable')
      .expect(200);
    expect((search.body as ReviewFeed).items).toHaveLength(1);
    expect((search.body as ReviewFeed).total).toBe(2);
    expect((search.body as ReviewFeed).filteredTotal).toBe(1);
    await request(app.getHttpServer())
      .get(url() + '?limit=100000')
      .expect(400);
  });
  it('stores helpful votes once, supports switching/removing votes, and prevents cross-product/self votes', async () => {
    const vote = url() + `/${review}/vote`;
    for (let i = 0; i < 2; i++)
      await request(app.getHttpServer())
        .post(vote)
        .set('Authorization', auth(visitor))
        .send({ helpful: true })
        .expect(201);
    expect(
      await prisma.productReviewVote.count({ where: { reviewId: review } }),
    ).toBe(1);
    expect(
      (await service.reviews(product)).items.find((r) => r.id === review)
        ?.helpfulCount,
    ).toBe(1);
    const changed = await request(app.getHttpServer())
      .post(vote)
      .set('Authorization', auth(visitor))
      .send({ helpful: false })
      .expect(201);
    expect(changed.body).toMatchObject({
      helpfulCount: 0,
      notHelpfulCount: 1,
      viewerVote: false,
    });
    await request(app.getHttpServer())
      .post(vote)
      .set('Authorization', auth(buyer))
      .send({ helpful: true })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/merchants/products/${otherProduct}/reviews/${review}/vote`)
      .set('Authorization', auth(visitor))
      .send({ helpful: true })
      .expect(404);
    await request(app.getHttpServer())
      .post(vote)
      .set('Authorization', auth(visitor))
      .send({ helpful: null })
      .expect(201);
    expect(
      await prisma.productReviewVote.count({ where: { reviewId: review } }),
    ).toBe(0);
  });
  it('persists an optional uploaded attachment and updates the buyer review instead of duplicating it', async () => {
    jest.mocked(uploadMerchantMedia).mockResolvedValue({
      mediaUrl: 'https://media.example/review.png',
      mediaType: 'IMAGE',
      publicId: 'test/review',
      resourceType: 'image',
    });
    const response = await request(app.getHttpServer())
      .post(url())
      .set('Authorization', auth(secondBuyer))
      .field('rating', '4')
      .field('comment', 'Updated after using this product')
      .attach('media', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
        filename: 'review.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect((response.body as SavedReview).mediaUrl).toBe(
      'https://media.example/review.png',
    );
    expect(response.body as SavedReview).not.toHaveProperty('mediaPublicId');
    expect(
      await prisma.productReview.count({
        where: { productId: product, userId: secondBuyer },
      }),
    ).toBe(1);
    expect(
      (await service.reviews(product)).items.find(
        (r) => r.id === (response.body as SavedReview).id,
      )?.mediaType,
    ).toBe('IMAGE');
    expect(uploadMerchantMedia).toHaveBeenCalledTimes(1);
  });
});
