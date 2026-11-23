import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  MerchantController,
  MerchantPublicController,
} from './merchant.controller';
import { MerchantService } from './merchant.service';

describe('product review HTTP contract', () => {
  let app: INestApplication<Server>, jwt: JwtService;
  const service = {
    offers: jest.fn().mockResolvedValue([]),
    reviews: jest
      .fn()
      .mockResolvedValue({ items: [], distribution: {}, total: 0, average: 0 }),
    review: jest.fn().mockResolvedValue({ id: 'review' }),
    reviewViewer: jest.fn().mockResolvedValue({ canReview: true }),
    voteProductReview: jest.fn().mockResolvedValue({ saved: true }),
    reportProductReview: jest.fn().mockResolvedValue({ reported: true }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ global: true, secret: 'review-http-test' }),
      ],
      controllers: [MerchantController, MerchantPublicController],
      providers: [{ provide: MerchantService, useValue: service }],
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
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('allows guest offer discovery without opening the saved-merchant feed', async () => {
    await request(app.getHttpServer())
      .get('/merchants/offers/discover')
      .expect(200, []);
    expect(service.offers).toHaveBeenCalledWith(null, true);
    await request(app.getHttpServer()).get('/merchants/offers').expect(401);
  });
  it('allows public reads with validated search/sort/pagination and protects viewer/write endpoints', async () => {
    const response = await request(app.getHttpServer())
      .get(
        '/merchants/products/product/reviews?search=bag&sort=highest&offset=3&limit=3',
      )
      .expect(200);
    expect((response.body as { total: number }).total).toBe(0);
    expect(service.reviews).toHaveBeenCalledWith(
      'product',
      expect.objectContaining({
        search: 'bag',
        sort: 'highest',
        offset: 3,
        limit: 3,
      }),
    );
    await request(app.getHttpServer())
      .get('/merchants/products/product/reviews?limit=999999')
      .expect(400);
    await request(app.getHttpServer())
      .get('/merchants/products/product/reviews/viewer')
      .expect(401);
    await request(app.getHttpServer())
      .post('/merchants/products/product/reviews')
      .send({ rating: 5, comment: 'Good bag' })
      .expect(401);
    expect(service.review).not.toHaveBeenCalled();
  });
  it('coerces multipart ratings, preserves optional media and rejects invalid fields before saving', async () => {
    const auth = `Bearer ${jwt.sign({ sub: 'buyer' })}`;
    await request(app.getHttpServer())
      .post('/merchants/products/product/reviews')
      .set('Authorization', auth)
      .field('rating', '5')
      .field('comment', 'Great bag')
      .attach('media', Buffer.from('test attachment'), {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(service.review).toHaveBeenCalledWith(
      'buyer',
      'product',
      expect.objectContaining({ rating: 5, comment: 'Great bag' }),
      expect.objectContaining({
        originalname: 'photo.png',
        mimetype: 'image/png',
      }),
    );
    service.review.mockClear();
    for (const rating of [0, 6, 2.5])
      await request(app.getHttpServer())
        .post('/merchants/products/product/reviews')
        .set('Authorization', auth)
        .send({ rating, comment: 'Good bag' })
        .expect(400);
    await request(app.getHttpServer())
      .post('/merchants/products/product/reviews')
      .set('Authorization', auth)
      .send({ rating: 5, comment: 'Good bag', helpfulCount: 100 })
      .expect(400);
    expect(service.review).not.toHaveBeenCalled();
  });
  it('allows a rating without text and reports a review as the authenticated user', async () => {
    const auth = `Bearer ${jwt.sign({ sub: 'reporter' })}`;
    await request(app.getHttpServer())
      .post('/merchants/products/product/reviews')
      .set('Authorization', auth)
      .send({ rating: 4 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/merchants/products/product/reviews/review/report')
      .set('Authorization', auth)
      .send({ reason: 'Spam', reporterId: 'other' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/merchants/products/product/reviews/review/report')
      .set('Authorization', auth)
      .send({ reason: 'Spam' })
      .expect(201);
    expect(service.reportProductReview).toHaveBeenLastCalledWith(
      'reporter',
      'product',
      'review',
      'Spam',
    );
  });
  it('validates helpful votes and passes the authenticated voter rather than a supplied user id', async () => {
    const auth = `Bearer ${jwt.sign({ sub: 'voter' })}`;
    for (const helpful of [true, false, null])
      await request(app.getHttpServer())
        .post('/merchants/products/product/reviews/review/vote')
        .set('Authorization', auth)
        .send({ helpful })
        .expect(201);
    expect(service.voteProductReview).toHaveBeenLastCalledWith(
      'voter',
      'product',
      'review',
      null,
    );
    await request(app.getHttpServer())
      .post('/merchants/products/product/reviews/review/vote')
      .set('Authorization', auth)
      .send({ helpful: 'yes' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/merchants/products/product/reviews/review/vote')
      .set('Authorization', auth)
      .send({ helpful: true, userId: 'someone-else' })
      .expect(400);
  });
});
