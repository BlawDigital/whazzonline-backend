jest.mock('prisma/prisma.service', () => ({ PrismaService: class {} }));

import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { configureHttp } from './http.config';
import { HealthController } from './health.controller';
import { MarketplaceController } from './marketplace/marketplace.controller';
import { MarketplaceService } from './marketplace/marketplace.service';
import { MerchantPublicController } from './merchants/merchant.controller';
import { MerchantService } from './merchants/merchant.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

describe('browser API HTTP contract (no database)', () => {
  let app: NestExpressApplication;
  let expired: string;
  const auth = {
    login: jest.fn(),
    getCurrentUser: jest.fn().mockResolvedValue({ id: 'test-user' }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'http-regression-test-only' })],
      controllers: [
        HealthController,
        MarketplaceController,
        MerchantPublicController,
        AuthController,
      ],
      providers: [
        JwtAuthGuard,
        {
          provide: MarketplaceService,
          useValue: {
            list: jest
              .fn()
              .mockResolvedValue({
                products: [{ id: 'product' }],
                vendors: [{ id: 'vendor' }],
              }),
          },
        },
        {
          provide: MerchantService,
          useValue: {
            feed: jest
              .fn()
              .mockResolvedValue({ items: [{ id: 'story' }], hasMore: false }),
          },
        },
        { provide: AuthService, useValue: auth },
      ],
    }).compile();
    expired = module
      .get(JwtService)
      .sign({ sub: 'test-user' }, { expiresIn: -1 });
    app = module.createNestApplication<NestExpressApplication>();
    configureHttp(app);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each(['https://whazzonline.com', 'https://www.whazzonline.com'])(
    'allows real public and preflight responses from %s',
    async (origin) => {
      await request(app.getHttpServer())
        .options('/auth/login')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          'content-type,authorization,x-invoice-token',
        )
        .expect(204)
        .expect('Access-Control-Allow-Origin', origin)
        .expect('Access-Control-Allow-Credentials', 'true')
        .expect(
          'Access-Control-Allow-Headers',
          'content-type,authorization,x-invoice-token',
        );
      const result = await request(app.getHttpServer())
        .get('/buyer/marketplace')
        .set('Origin', origin)
        .expect(200)
        .expect('Access-Control-Allow-Origin', origin);
      expect(result.body).toEqual({
        products: [{ id: 'product' }],
        vendors: [{ id: 'vendor' }],
      });
      await request(app.getHttpServer())
        .get('/merchants/stories')
        .set('Origin', origin)
        .expect(200)
        .expect('Access-Control-Allow-Origin', origin);
    },
  );
  it('does not grant CORS to an untrusted origin', async () => {
    const response = await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', 'https://whazzonline.com.evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
  it.each([
    '/buyer/marketplace',
    '/merchants/stories',
    '/merchants/vendor/content',
  ])(
    'keeps public %s accessible with missing or expired auth',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(200);
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${expired}`)
        .expect(200);
    },
  );
  it('keeps private routes protected with missing, malformed and expired tokens', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer malformed')
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
  });
  it('accepts a valid login DTO and preserves a credential rejection with CORS', async () => {
    const body = {
      email: 'http-test@example.test',
      password: 'test-only-password',
    };
    auth.login.mockResolvedValueOnce({ accessToken: 'test-response-token' });
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://www.whazzonline.com')
      .send(body)
      .expect(201)
      .expect('Access-Control-Allow-Origin', 'https://www.whazzonline.com');
    auth.login.mockRejectedValueOnce(
      new UnauthorizedException('Invalid email/phone or password.'),
    );
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://whazzonline.com')
      .send(body)
      .expect(401)
      .expect('Access-Control-Allow-Origin', 'https://whazzonline.com');
  });
  it('provides uncached liveness independently of queries', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect({ status: 'ok' });
  });
});
