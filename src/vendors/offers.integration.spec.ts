import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { isolatedInvoiceDatabase } from '../../test/helpers/isolated-invoice-database';
import { PrismaService } from '../../prisma/prisma.service';
import { VendorsService } from './vendors.service';
import { VendorsController } from './vendors.controller';
import { StoreCommunityService } from './store-community.service';
import { MerchantService } from '../merchants/merchant.service';
import { MerchantController } from '../merchants/merchant.controller';
import {
  GoodsInvoicesService,
  type InvoiceLine,
} from '../invoices/goods-invoices.service';
import {
  CreateOfferType,
  CreateOfferDiscountType,
  CreateDeliveryOfferType,
  type CreateOfferDto,
} from './dto/create-offer.dto';
const databaseTests =
  process.env.RUN_OFFER_DATABASE_TESTS === '1' ? describe : describe.skip;
databaseTests('offers with isolated PostgreSQL and authenticated HTTP', () => {
  jest.setTimeout(180000);
  let db: PrismaService,
    cleanup: () => Promise<void>,
    app: INestApplication<Server>,
    vendors: VendorsService,
    invoices: GoodsInvoicesService,
    merchants: MerchantService,
    jwt: JwtService;
  let buyer: string;
  beforeAll(async () => {
    const database = await isolatedInvoiceDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'isolated-offer-test-only' })],
      controllers: [VendorsController, MerchantController],
      providers: [
        { provide: PrismaService, useValue: db },
        VendorsService,
        StoreCommunityService,
        MerchantService,
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<Server>>({
      logger: false,
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    vendors = app.get(VendorsService);
    merchants = app.get(MerchantService);
    jwt = app.get(JwtService);
    invoices = new GoodsInvoicesService(db);
    buyer = (
      await db.user.create({
        data: { email: `${randomUUID()}@example.test`, isActive: true },
      })
    ).id;
  });
  afterAll(async () => {
    if (app) await app.close();
    if (cleanup) await cleanup();
  });
  async function store(quantities = [20, 20]) {
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        role: 'VENDOR',
        registrationType: 'SELLER',
        isActive: true,
      },
    });
    const profile = await db.vendorProfile.create({
      data: {
        userId: user.id,
        storeName: 'Offer Test Store',
        setupCompleted: true,
        city: 'Yaba',
        state: 'Lagos',
        lga: 'Yaba',
        address: 'Test road',
        category: 'Fashion',
        subCategory: 'Watches',
        description: 'Isolated test store',
        bankName: 'Test Bank',
        bankAccountName: 'Offer Test Store',
        bankAccountNumber: '1234567890',
      },
    });
    const products = await Promise.all(
      quantities.map((quantity, i) =>
        db.product.create({
          data: {
            vendorProfileId: profile.id,
            name: `Product ${i + 1}`,
            category: 'Fashion',
            unitPrice: (i + 1) * 1000,
            quantity,
            imageUrls: [],
          },
        }),
      ),
    );
    return { user, profile, products };
  }
  function discount(
    ids: string[],
    extra: Partial<CreateOfferDto> = {},
  ): CreateOfferDto {
    return {
      type: CreateOfferType.PRICE_DISCOUNT,
      productIds: ids,
      durationHours: 24,
      discountType: CreateOfferDiscountType.PERCENTAGE,
      discountValue: 20,
      name: 'A real offer',
      ...extra,
    };
  }
  function auth(id: string) {
    return `Bearer ${jwt.sign({ sub: id })}`;
  }
  async function checkout(
    vendorId: string,
    items: { id: string; quantity: number }[],
    address = 'Test road, Yaba, Lagos',
    deliveryFee = 0,
  ) {
    const lines: InvoiceLine[] = items.map((p) => ({
      productId: p.id,
      quantity: p.quantity,
      vendorId,
      vendorName: 'Offer Test Store',
      name: 'Product',
      subtitle: 'Fashion',
      imageUri: '',
      sku: p.id,
      unitPrice: 1,
      originalPrice: null,
      selectedColor: null,
      selectedSize: null,
      selectedVariants: {},
      deliveryAddress: address,
    }));
    return invoices.createCheckout({
      userId: buyer,
      lines,
      address: { label: address, latitude: 0, longitude: 0 },
      deliveryFee,
      paymentMethod: 'bank',
      idempotencyKey: randomUUID(),
    });
  }
  it.each([24, 48, 72, 100])(
    'accepts %i hours and schedules without exposing the offer early',
    async (durationHours) => {
      const s = await store();
      const startsAt = new Date(Date.now() + 86400000).toISOString();
      const response = await request(app.getHttpServer())
        .post(`/vendors/${s.user.id}/offers`)
        .set('Authorization', auth(s.user.id))
        .send(discount([s.products[0].id], { durationHours, startsAt }))
        .expect(201);
      const data = response.body as {
        status: string;
        startsAt: string;
        endsAt: string;
      };
      expect(data.status).toBe('SCHEDULED');
      expect(Date.parse(data.endsAt) - Date.parse(data.startsAt)).toBe(
        durationHours * 3600000,
      );
      await merchants.saveContact(buyer, s.user.id);
      expect(
        (await merchants.offers(buyer)).some(
          (o) => o.vendorProfile.userId === s.user.id,
        ),
      ).toBe(false);
      expect(
        (await checkout(s.user.id, [{ id: s.products[0].id, quantity: 1 }]))
          .total,
      ).toBe(1000);
    },
  );
  it('rejects invalid duration, foreign products, zero stock and non-owner requests', async () => {
    const s = await store([0, 20]),
      other = await store();
    const path = `/vendors/${s.user.id}/offers`;
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth(other.user.id))
      .send(discount([s.products[1].id]))
      .expect(403);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth(s.user.id))
      .send(discount([s.products[1].id], { durationHours: 12 }))
      .expect(400);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth(s.user.id))
      .send(discount([other.products[0].id]))
      .expect(400);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth(s.user.id))
      .send(discount([s.products[0].id]))
      .expect(400);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', auth(s.user.id))
      .send(discount([s.products[1].id], { discountValue: 100 }))
      .expect(400);
  });
  it('saves drafts without changing prices, resumes and publishes once on retries', async () => {
    const s = await store();
    const dto = discount([s.products[0].id], {
      intent: 'DRAFT',
      requestId: randomUUID(),
      description: 'A saved description',
      mediaUrls: ['https://example.com/offer.png'],
    });
    const draft = await vendors.createOffer(s.user.id, dto);
    expect(draft.status).toBe('DRAFT');
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: s.products[0].id } }))
        .promoPrice,
    ).toBeNull();
    await expect(
      vendors.createOffer(s.user.id, { ...dto, intent: 'PUBLISH' }, draft.id),
    ).resolves.toMatchObject({ id: draft.id, status: 'ACTIVE' });
    await expect(
      vendors.createOffer(s.user.id, { ...dto, intent: 'PUBLISH' }, draft.id),
    ).resolves.toMatchObject({ id: draft.id, status: 'ACTIVE' });
    expect(
      await db.offer.count({ where: { vendorProfileId: s.profile.id } }),
    ).toBe(1);
    expect(
      (await checkout(s.user.id, [{ id: s.products[0].id, quantity: 1 }]))
        .total,
    ).toBe(800);
  });
  it('returns saved contacts only and exposes real offer/product media and metadata', async () => {
    const s = await store();
    await vendors.createOffer(
      s.user.id,
      discount([s.products[0].id], {
        description: 'Offer description',
        mediaUrls: ['https://example.com/media.png'],
      }),
    );
    expect(
      (await merchants.offers(buyer)).some(
        (o) => o.vendorProfile.userId === s.user.id,
      ),
    ).toBe(false);
    await merchants.saveContact(buyer, s.user.id);
    const response = await request(app.getHttpServer())
      .get('/merchants/offers')
      .set('Authorization', auth(buyer))
      .expect(200);
    const offers = response.body as {
      description: string;
      vendorProfile: { userId: string };
      products: { product: { unitPrice: number } }[];
    }[];
    expect(
      offers.find((o) => o.vendorProfile.userId === s.user.id),
    ).toMatchObject({
      description: 'Offer description',
      products: [{ product: { unitPrice: 1000 } }],
    });
    expect(
      (await merchants.offers(buyer, true)).some(
        (o) => o.vendorProfile.userId === s.user.id,
      ),
    ).toBe(true);
  });
  it('applies bundle pricing to complete sets and charges remaining units normally', async () => {
    const s = await store();
    await vendors.createOffer(s.user.id, {
      type: CreateOfferType.BUNDLE_DEAL,
      productIds: s.products.map((p) => p.id),
      name: 'Together',
      bundlePrice: 2400,
      durationHours: 24,
    });
    const quote = await invoices.quote({
      items: [
        { productId: s.products[0].id, quantity: 2 },
        { productId: s.products[1].id, quantity: 1 },
      ],
    });
    expect(quote).toMatchObject({
      originalSubtotal: 4000,
      subtotal: 3400,
      discount: 600,
      total: 3400,
    });
    expect(
      (
        await invoices.quote({
          items: [{ productId: s.products[0].id, quantity: 1 }],
        })
      ).total,
    ).toBe(1000);
    const result = await checkout(s.user.id, [
      { id: s.products[0].id, quantity: 2 },
      { id: s.products[1].id, quantity: 1 },
    ]);
    expect(result.total).toBe(3400);
    const order = await db.commerceOrder.findUniqueOrThrow({
      where: { id: result.id },
      include: { items: true },
    });
    expect(
      order.items.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
    ).toBe(3400);
    expect(order.items.reduce((sum, l) => sum + l.quantity, 0)).toBe(3);
  });
  it('enforces flash limits atomically and returns reserved offer units after cancellation', async () => {
    const s = await store();
    const offer = await vendors.createOffer(
      s.user.id,
      discount([s.products[0].id], {
        type: CreateOfferType.FLASH_SALE,
        stockLimit: 2,
      }),
    );
    const outcomes = await Promise.allSettled([
      checkout(s.user.id, [{ id: s.products[0].id, quantity: 2 }]),
      checkout(s.user.id, [{ id: s.products[0].id, quantity: 2 }]),
    ]);
    const discounted = outcomes.filter(
      (r) => r.status === 'fulfilled' && r.value.total === 1600,
    );
    expect(discounted).toHaveLength(1);
    const successful = discounted[0];
    if (successful.status !== 'fulfilled') throw new Error('Missing checkout');
    expect(successful.value.total).toBe(1600);
    expect(
      (await db.offer.findUniqueOrThrow({ where: { id: offer.id } }))
        .unitsClaimed,
    ).toBe(2);
    await invoices.void(successful.value.invoices[0].id, s.user.id);
    await invoices.void(successful.value.invoices[0].id, s.user.id);
    expect(
      (await db.offer.findUniqueOrThrow({ where: { id: offer.id } }))
        .unitsClaimed,
    ).toBe(0);
    expect(
      (await checkout(s.user.id, [{ id: s.products[0].id, quantity: 2 }]))
        .total,
    ).toBe(1600);
  });
  it('only applies conditional discounts when the merchant minimum is reached', async () => {
    const s = await store();
    await vendors.createOffer(
      s.user.id,
      discount([s.products[0].id], { minimumOrderValue: 2000 }),
    );
    expect(
      (await checkout(s.user.id, [{ id: s.products[0].id, quantity: 1 }]))
        .total,
    ).toBe(1000);
    expect(
      (await checkout(s.user.id, [{ id: s.products[0].id, quantity: 2 }]))
        .total,
    ).toBe(1600);
  });
  it('applies delivery rules to eligible locations and minimums without adding a new fee', async () => {
    const s = await store();
    await vendors.createOffer(s.user.id, {
      type: CreateOfferType.DELIVERY,
      productIds: s.products.map((p) => p.id),
      durationHours: 24,
      deliveryType: CreateDeliveryOfferType.FREE,
      minimumOrderValue: 2000,
      applicableLocations: ['STATE:Lagos'],
    });
    expect(
      (
        await checkout(
          s.user.id,
          [{ id: s.products[0].id, quantity: 1 }],
          'Yaba, Lagos',
          500,
        )
      ).total,
    ).toBe(1500);
    expect(
      (
        await checkout(
          s.user.id,
          [{ id: s.products[0].id, quantity: 2 }],
          'Yaba, Lagos',
          500,
        )
      ).total,
    ).toBe(2000);
    expect(
      (
        await checkout(
          s.user.id,
          [{ id: s.products[0].id, quantity: 2 }],
          'Abeokuta, Ogun',
          500,
        )
      ).total,
    ).toBe(2500);
  });
  it('rejects overlapping offers and keeps expired offers out of checkout pricing', async () => {
    const s = await store();
    const first = await vendors.createOffer(
      s.user.id,
      discount([s.products[0].id]),
    );
    await expect(
      vendors.createOffer(s.user.id, discount([s.products[0].id])),
    ).rejects.toThrow('already belongs');
    await db.offer.update({
      where: { id: first.id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    await db.product.update({
      where: { id: s.products[0].id },
      data: { promoEndsAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await checkout(s.user.id, [{ id: s.products[0].id, quantity: 1 }]))
        .total,
    ).toBe(1000);
  });
  it('retains older product promotions in merchant and buyer offers without duplicating wizard offers', async () => {
    const s = await store();
    await vendors.createProductOffer(s.user.id, s.products[0].id, {
      promoPrice: 800,
      durationHours: 24,
    });
    await merchants.saveContact(buyer, s.user.id);
    expect(
      (await vendors.findOffers(s.user.id)).filter((o) =>
        o.products.some((p) => p.id === s.products[0].id),
      ),
    ).toHaveLength(1);
    expect(
      (await merchants.offers(buyer)).find(
        (o) => o.id === `product-${s.products[0].id}`,
      ),
    ).toMatchObject({ discountValue: 800 });
    const structured = await vendors.createOffer(
      s.user.id,
      discount([s.products[1].id]),
    );
    expect(
      (await merchants.offers(buyer)).filter((o) =>
        o.products.some(
          (p: { product: { id: string } }) => p.product.id === s.products[1].id,
        ),
      ),
    ).toHaveLength(1);
    expect(
      (await vendors.findOffers(s.user.id)).some((o) => o.id === structured.id),
    ).toBe(true);
  });
  it('rejects disguised offer media before attempting cloud storage', async () => {
    const s = await store();
    await request(app.getHttpServer())
      .post(`/vendors/${s.user.id}/offers/media`)
      .set('Authorization', auth(s.user.id))
      .attach('images', Buffer.from('not a png'), {
        filename: 'offer.png',
        contentType: 'image/png',
      })
      .expect(400);
  });
  it('never raises an existing product promotion when the normal price changes', async () => {
    const s = await store();
    await vendors.createOffer(s.user.id, discount([s.products[0].id]));
    await db.product.update({
      where: { id: s.products[0].id },
      data: { unitPrice: 1200 },
    });
    expect(
      (await checkout(s.user.id, [{ id: s.products[0].id, quantity: 1 }]))
        .total,
    ).toBe(800);
  });
});
