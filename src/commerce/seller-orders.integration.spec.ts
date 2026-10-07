import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../../prisma/prisma.service';

interface TestPayload {
  orders: unknown[];
  items: unknown[];
  total: number;
  customer: { id: string };
  paymentStatus: string;
  id: string;
  mode: string;
  status: string;
  history: { status: string }[];
  request: { id: string; fee: number };
  supportTicketId: string;
  notifications: {
    id: string;
    orderId: string;
    ticketId: string;
    title: string;
    body: string;
    read: boolean;
  }[];
  conversations: { id: string; orderId: string }[];
}
const payload = (response: { body: unknown }) => response.body as TestPayload;

const isolated =
  /^postgresql:\/\/[^@]+@localhost:5433\/seller_web_verification(?:\?|$)/.test(
    process.env.DATABASE_URL ?? '',
  );
(isolated ? describe : describe.skip)(
  'Vendor order HTTP lifecycle with PostgreSQL',
  () => {
    jest.setTimeout(60000);
    let app: NestExpressApplication;
    let db: PrismaService;
    const buyer = randomUUID(),
      seller = randomUUID(),
      secondSeller = randomUUID(),
      outsider = randomUUID(),
      admin = randomUUID();
    let sellerToken: string,
      secondToken: string,
      buyerToken: string,
      outsiderToken: string,
      adminToken: string;
    let productId: string,
      secondProductId: string,
      orderId: string,
      rejectedId: string,
      stockId: string,
      ticketId: string;
    const auth = (token: string) => `Bearer ${token}`;
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
      [sellerToken, secondToken, buyerToken, outsiderToken, adminToken] =
        await Promise.all(
          [seller, secondSeller, buyer, outsider, admin].map((sub) =>
            jwt.signAsync({ sub }),
          ),
        );
      for (const id of [buyer, seller, secondSeller, outsider, admin])
        await db.user.create({
          data: {
            id,
            firstName: id === buyer ? 'Order test buyer' : 'Order test seller',
            registrationType: [seller, secondSeller, outsider].includes(id)
              ? 'SELLER'
              : 'BUYER',
            role:
              id === admin
                ? 'ADMIN'
                : [seller, secondSeller, outsider].includes(id)
                  ? 'VENDOR'
                  : 'CUSTOMER',
          },
        });
      for (const id of [seller, secondSeller, outsider])
        await db.vendorProfile.create({
          data: {
            userId: id,
            storeName: 'Order test store',
            category: 'Fashion',
            subCategory: 'Watches',
            state: 'Lagos',
            city: 'Ikeja',
            lga: 'Ikeja',
            address: 'Test address',
            description: 'Isolated order verification',
            setupCompleted: true,
          },
        });
      const profile = await db.vendorProfile.findUniqueOrThrow({
        where: { userId: seller },
      });
      const secondProfile = await db.vendorProfile.findUniqueOrThrow({
        where: { userId: secondSeller },
      });
      productId = (
        await db.product.create({
          data: {
            vendorProfileId: profile.id,
            category: 'Watches',
            name: 'Vendor one watch',
            unitPrice: 12000,
            quantity: 6,
            imageUrls: [],
          },
        })
      ).id;
      secondProductId = (
        await db.product.create({
          data: {
            vendorProfileId: secondProfile.id,
            category: 'Bags',
            name: 'Vendor two bag',
            unitPrice: 9000,
            quantity: 6,
            imageUrls: [],
          },
        })
      ).id;
      const createOrder = async (quantity: number, multi = false) =>
        db.commerceOrder.create({
          data: {
            userId: buyer,
            deliveryAddress: 'Test delivery address',
            latitude: 6.5,
            longitude: 3.4,
            paymentMethod: 'card',
            subtotal: quantity * 12000 + (multi ? 9000 : 0),
            total: quantity * 12000 + (multi ? 9000 : 0),
            serviceFee: 0,
            deliveryFee: 0,
            items: {
              create: [
                {
                  productId,
                  vendorId: seller,
                  vendorName: 'Vendor one',
                  name: 'Watch',
                  subtitle: 'Black',
                  imageUri: '',
                  sku: 'test-watch',
                  unitPrice: 12000,
                  quantity,
                  deliveryAddress: 'Test delivery address',
                },
                ...(multi
                  ? [
                      {
                        productId: secondProductId,
                        vendorId: secondSeller,
                        vendorName: 'Vendor two',
                        name: 'Bag',
                        subtitle: 'Brown',
                        imageUri: '',
                        sku: 'test-bag',
                        unitPrice: 9000,
                        quantity: 1,
                        deliveryAddress: 'Test delivery address',
                      },
                    ]
                  : []),
              ],
            },
            fulfillments: {
              create: [seller, ...(multi ? [secondSeller] : [])].map(
                (vendorId) => ({
                  vendorId,
                  status: 'pending',
                  history: {
                    create: { status: 'pending', actorUserId: buyer },
                  },
                }),
              ),
            },
          },
        });
      orderId = (await createOrder(2, true)).id;
      rejectedId = (await createOrder(1)).id;
      stockId = (await createOrder(20)).id;
    });
    afterAll(async () => {
      if (db) {
        await db.commerceOrder.deleteMany({ where: { userId: buyer } });
        await db.user.deleteMany({
          where: { id: { in: [buyer, seller, secondSeller, outsider, admin] } },
        });
      }
      await app?.close();
    });
    it('returns only this vendor’s items and totals and rejects unrelated accounts', async () => {
      const list = await request(app.getHttpServer())
        .get('/seller/orders')
        .set('Authorization', auth(sellerToken))
        .expect(200);
      expect(payload(list).orders).toHaveLength(3);
      const detail = await request(app.getHttpServer())
        .get(`/seller/orders/${orderId}`)
        .set('Authorization', auth(sellerToken))
        .expect(200);
      expect(payload(detail).items).toHaveLength(1);
      expect(payload(detail).total).toBe(24000);
      expect(payload(detail).customer.id).toBe(buyer);
      expect(payload(detail).paymentStatus).toBe('unverified');
      await request(app.getHttpServer())
        .get(`/seller/orders/${orderId}`)
        .set('Authorization', auth(outsiderToken))
        .expect(404);
      await request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/accept`)
        .set('Authorization', auth(outsiderToken))
        .expect(404);
      await request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/delivery-requests`)
        .set('Authorization', auth(sellerToken))
        .send({ serviceLevel: 'standard' })
        .expect(409);
    });
    it('accepts concurrent retries once, reserves stock once, and notifies the buyer', async () => {
      const results = await Promise.all(
        [1, 2].map(() =>
          request(app.getHttpServer())
            .post(`/seller/orders/${orderId}/accept`)
            .set('Authorization', auth(sellerToken)),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: productId } }))
          .quantity,
      ).toBe(4);
      const fulfillment = await db.sellerFulfillment.findUniqueOrThrow({
        where: { orderId_vendorId: { orderId, vendorId: seller } },
        include: { history: true },
      });
      expect(
        fulfillment.history.filter((event) => event.status === 'processing'),
      ).toHaveLength(1);
      expect(
        (await db.commerceOrder.findUniqueOrThrow({ where: { id: orderId } }))
          .status,
      ).toBe('confirmed');
      const feed = await request(app.getHttpServer())
        .get('/merchants/notifications')
        .set('Authorization', auth(buyerToken))
        .expect(200);
      expect(
        payload(feed).notifications.some(
          (n: { orderId: string; title: string; read: boolean }) =>
            n.orderId === orderId && n.title === 'Order accepted' && !n.read,
        ),
      ).toBe(true);
      await request(app.getHttpServer())
        .patch(`/seller/orders/${orderId}/status`)
        .set('Authorization', auth(sellerToken))
        .send({ status: 'delivered' })
        .expect(409);
    });
    it('rolls back acceptance when stock is insufficient', async () => {
      await request(app.getHttpServer())
        .post(`/seller/orders/${stockId}/accept`)
        .set('Authorization', auth(sellerToken))
        .expect(409);
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: productId } }))
          .quantity,
      ).toBe(4);
      expect(
        (
          await db.sellerFulfillment.findUniqueOrThrow({
            where: { orderId_vendorId: { orderId: stockId, vendorId: seller } },
          })
        ).status,
      ).toBe('pending');
    });
    it('rejects with a persisted reason, does not reserve stock, and disables further changes', async () => {
      await request(app.getHttpServer())
        .post(`/seller/orders/${rejectedId}/reject`)
        .set('Authorization', auth(sellerToken))
        .send({ reason: 'Out of stock: restocking next week' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/seller/orders/${rejectedId}/accept`)
        .set('Authorization', auth(sellerToken))
        .expect(409);
      const feed = await request(app.getHttpServer())
        .get('/merchants/notifications')
        .set('Authorization', auth(buyerToken))
        .expect(200);
      expect(
        payload(feed).notifications.some(
          (n: { orderId: string; body: string }) =>
            n.orderId === rejectedId && n.body.includes('restocking next week'),
        ),
      ).toBe(true);
    });
    it('requests delivery once under concurrent retries and preserves the selected service', async () => {
      const results = await Promise.all(
        [1, 2].map(() =>
          request(app.getHttpServer())
            .post(`/seller/orders/${orderId}/delivery-requests`)
            .set('Authorization', auth(sellerToken))
            .send({ serviceLevel: 'priority' }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(payload(results[0]).request.id).toBe(
        payload(results[1]).request.id,
      );
      expect(payload(results[0]).mode).toBe('mock');
      expect(payload(results[0]).request.fee).toBe(2500);
      await request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/delivery-requests`)
        .set('Authorization', auth(sellerToken))
        .send({ serviceLevel: 'standard' })
        .expect(409);
    });
    it('opens one order conversation and returns an authorized link for both participants', async () => {
      const first = await request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/conversation`)
        .set('Authorization', auth(sellerToken))
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/conversation`)
        .set('Authorization', auth(sellerToken))
        .expect(201);
      expect(payload(first).id).toBe(payload(second).id);
      for (const token of [sellerToken, buyerToken]) {
        const chats = await request(app.getHttpServer())
          .get('/buyer/conversations')
          .set('Authorization', auth(token))
          .expect(200);
        expect(
          payload(chats).conversations.find(
            (c: { id: string }) => c.id === payload(first).id,
          )?.orderId,
        ).toBe(orderId);
      }
      await request(app.getHttpServer())
        .get(`/buyer/conversations/${payload(first).id}/messages`)
        .set('Authorization', auth(outsiderToken))
        .expect(404);
      await request(app.getHttpServer())
        .post(`/buyer/conversations/${payload(first).id}/messages`)
        .set('Authorization', auth(sellerToken))
        .send({ kind: 'text', text: 'Your order is being prepared.' })
        .expect(201);
      const messages = await request(app.getHttpServer())
        .get(`/buyer/conversations/${payload(first).id}/messages`)
        .set('Authorization', auth(buyerToken))
        .expect(200);
      expect(
        (messages.body as { text: string }[]).some(
          (m: { text: string }) => m.text === 'Your order is being prepared.',
        ),
      ).toBe(true);
    });
    it('persists disputes and support replies with correct notification destinations', async () => {
      const dispute = await request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/disputes`)
        .set('Authorization', auth(sellerToken))
        .send({
          reason: 'Delivery issue',
          description: 'Please review this delivery request.',
        })
        .expect(201);
      ticketId = payload(dispute).supportTicketId;
      expect(ticketId).toBeTruthy();
      await request(app.getHttpServer())
        .get(`/seller/support/tickets/${ticketId}`)
        .set('Authorization', auth(outsiderToken))
        .expect(404);
      await request(app.getHttpServer())
        .post(`/admin/support/tickets/${ticketId}/messages`)
        .set('Authorization', auth(adminToken))
        .send({ text: 'We are reviewing your delivery.' })
        .expect(201);
      const feed = await request(app.getHttpServer())
        .get('/seller/notifications')
        .set('Authorization', auth(sellerToken))
        .expect(200);
      const notice = payload(feed).notifications.find(
        (n: { ticketId: string }) => n.ticketId === ticketId,
      );
      expect(notice?.orderId).toBe(orderId);
      expect(notice?.read).toBe(false);
      await request(app.getHttpServer())
        .patch('/seller/notifications/read')
        .set('Authorization', auth(sellerToken))
        .send({ ids: [notice!.id] })
        .expect(200);
      const reloaded = await request(app.getHttpServer())
        .get('/seller/notifications')
        .set('Authorization', auth(sellerToken))
        .expect(200);
      expect(
        payload(reloaded).notifications.find(
          (n: { id: string }) => n.id === notice!.id,
        )?.read,
      ).toBe(true);
      await request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/disputes`)
        .set('Authorization', auth(outsiderToken))
        .send({ reason: 'Delivery issue', description: 'Wrong owner' })
        .expect(404);
    });
    it('supports persisted pickup aliases, delivery selection, and forward-only updates', async () => {
      const legacy = await db.sellerFulfillment.findUniqueOrThrow({
        where: { orderId_vendorId: { orderId, vendorId: seller } },
      });
      await db.sellerFulfillment.update({
        where: { id: legacy.id },
        data: { status: 'ready_for_pickup' },
      });
      await db.sellerFulfillmentEvent.create({
        data: {
          fulfillmentId: legacy.id,
          actorUserId: seller,
          status: 'ready-for-pickup',
        },
      });
      const detail = await request(app.getHttpServer())
        .get(`/seller/orders/${orderId}`)
        .set('Authorization', auth(sellerToken))
        .expect(200);
      expect(payload(detail).status).toBe('ready');
      expect(
        payload(detail).history.some(
          (event: { status: string }) => event.status === 'ready-for-pickup',
        ),
      ).toBe(false);
      await request(app.getHttpServer())
        .patch(`/seller/orders/${orderId}/status`)
        .set('Authorization', auth(sellerToken))
        .send({ status: 'processing' })
        .expect(409);
      await request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/delivery-requests`)
        .set('Authorization', auth(sellerToken))
        .send({ serviceLevel: 'priority' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/seller/orders/${orderId}/status`)
        .set('Authorization', auth(sellerToken))
        .send({ status: 'out-for-delivery' })
        .expect(200);
      expect(
        (await db.product.findUniqueOrThrow({ where: { id: productId } }))
          .quantity,
      ).toBe(4);
    });
    it('updates each vendor sequentially and completes the aggregate order only when both finish', async () => {
      for (const status of ['out_for_delivery', 'delivered'])
        await request(app.getHttpServer())
          .patch(`/seller/orders/${orderId}/status`)
          .set('Authorization', auth(sellerToken))
          .send({ status })
          .expect(200);
      expect(
        (await db.commerceOrder.findUniqueOrThrow({ where: { id: orderId } }))
          .completedAt,
      ).toBeNull();
      await request(app.getHttpServer())
        .post(`/seller/orders/${orderId}/accept`)
        .set('Authorization', auth(secondToken))
        .expect(201);
      for (const status of ['ready', 'out_for_delivery', 'delivered'])
        await request(app.getHttpServer())
          .patch(`/seller/orders/${orderId}/status`)
          .set('Authorization', auth(secondToken))
          .send({ status })
          .expect(200);
      const result = await db.commerceOrder.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(result.status).toBe('delivered');
      expect(result.completedAt).not.toBeNull();
      expect(
        (
          await db.deliveryRequest.findFirstOrThrow({
            where: { fulfillment: { orderId, vendorId: seller } },
          })
        ).status,
      ).toBe('delivered');
    });
  },
);
