import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { isolatedInvoiceDatabase } from '../../test/helpers/isolated-invoice-database';
import { GoodsInvoicesService } from './goods-invoices.service';
import { WalletService } from '../wallet/wallet.service';
import { WalletController } from '../wallet/wallet.controller';
import * as bcrypt from 'bcrypt';
import { CommerceService } from '../commerce/commerce.service';
import { SellerOrdersService } from '../commerce/seller-orders.service';
import { MockDeliveryProvider } from '../commerce/delivery.provider';
import { VendorsService } from '../vendors/vendors.service';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import {
  GoodsInvoicesController,
  MerchantPaymentsController,
} from './goods-invoices.controller';
jest.setTimeout(180000);
const databaseTests =
  process.env.RUN_INVOICE_DATABASE_TESTS === '1' ? describe : describe.skip;
databaseTests('direct merchant invoice integration', () => {
  let prisma: PrismaService,
    cleanup: () => Promise<void>,
    invoices: GoodsInvoicesService,
    commerce: CommerceService;
  let buyer: string,
    vendor: string,
    otherVendor: string,
    product: string,
    otherProduct: string;
  const merchantKey = 'sk_test_merchantprivatekey123456789',
    platformKey = 'sk_test_whazzplatformkey123456789',
    jwtSecret = 'isolated-invoice-authentication-test';
  const originalFetch = global.fetch;
  const original = {
    key: process.env.MERCHANT_PAYMENT_ENCRYPTION_KEY,
    enabled: process.env.MERCHANT_PAYSTACK_CHECKOUT_ENABLED,
    paystack: process.env.PAYSTACK_SECRET_KEY,
  };
  let provider: Record<string, unknown> = {};
  beforeAll(async () => {
    const database = await isolatedInvoiceDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
    invoices = new GoodsInvoicesService(prisma);
    commerce = new CommerceService(prisma, invoices);
    process.env.MERCHANT_PAYMENT_ENCRYPTION_KEY =
      randomBytes(32).toString('base64');
    process.env.MERCHANT_PAYSTACK_CHECKOUT_ENABLED = 'false';
    process.env.PAYSTACK_SECRET_KEY = platformKey;
    buyer = (
      await prisma.user.create({
        data: {
          email: 'buyer@example.com',
          firstName: 'Test',
          lastName: 'Buyer',
          isActive: true,
          isVerified: true,
        },
      })
    ).id;
    async function merchant(name: string, email: string, account: string) {
      const u = await prisma.user.create({
        data: {
          email,
          role: 'VENDOR',
          registrationType: 'SELLER',
          isActive: true,
          isVerified: true,
        },
      });
      const profile = await prisma.vendorProfile.create({
        data: {
          userId: u.id,
          storeName: name,
          setupCompleted: true,
          category: 'Fashion',
          subCategory: 'Clothes',
          state: 'Lagos',
          city: 'Lagos',
          lga: 'Yaba',
          address: 'Test address',
          description: 'Test store',
          bankName: 'Test Bank',
          bankAccountName: name,
          bankAccountNumber: account,
          bankCode: '123',
        },
      });
      const p = await prisma.product.create({
        data: {
          vendorProfileId: profile.id,
          category: 'Fashion',
          name: name + ' product',
          unitPrice: 2500,
          quantity: 100,
          imageUrls: [],
        },
      });
      return { userId: u.id, productId: p.id };
    }
    const a = await merchant('First Store', 'first@example.com', '1234567890'),
      b = await merchant('Second Store', 'second@example.com', '0987654321');
    vendor = a.userId;
    product = a.productId;
    otherVendor = b.userId;
    otherProduct = b.productId;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ status: true, data: provider }),
    })) as unknown as typeof fetch;
  }, 240000);
  afterAll(async () => {
    global.fetch = originalFetch;
    for (const [key, value] of [
      ['MERCHANT_PAYMENT_ENCRYPTION_KEY', original.key],
      ['MERCHANT_PAYSTACK_CHECKOUT_ENABLED', original.enabled],
      ['PAYSTACK_SECRET_KEY', original.paystack],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
    if (cleanup) await cleanup();
  });
  async function checkout(ids = [product], key = randomUUID()) {
    const selected: { cartItemId: string; quantity: number }[] = [];
    for (const id of ids) {
      const item = await commerce.addItem(buyer, {
        productId: id,
        quantity: 2,
        vendorId: 'ignored',
        vendorName: 'ignored',
        name: 'ignored',
        imageUri: '',
        unitPrice: 1,
        deliveryAddress: 'Test delivery',
      });
      selected.push({ cartItemId: item.id, quantity: 2 });
    }
    return commerce.checkout(buyer, {
      paymentMethod: 'bank',
      address: { label: 'Test delivery', latitude: 6.5, longitude: 3.3 },
      cartSelection: selected,
      idempotencyKey: key,
    });
  }
  it('uses server prices and independent merchant bank invoices without any central collection', async () => {
    const key = randomUUID(),
      batch = await checkout([product, otherProduct], key);
    expect(batch.total).toBe(10000);
    expect(batch.invoices).toHaveLength(2);
    expect(global.fetch).not.toHaveBeenCalled();
    for (const invoice of batch.invoices) {
      const read = await invoices.get(invoice.id, { userId: buyer });
      expect(read.total).toBe(5000);
      expect(read.bank).toMatchObject({ bankName: 'Test Bank' });
      expect(read.receiptNumber).toBeNull();
      expect(read.secureCheckoutAvailable).toBe(false);
    }
    const repeated = await commerce.checkout(buyer, {
      paymentMethod: 'bank',
      address: { label: 'Test delivery', latitude: 6.5, longitude: 3.3 },
      idempotencyKey: key,
    });
    expect(repeated.id).toBe(batch.id);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: product } }))
        .quantity,
    ).toBe(98);
    await expect(
      invoices.confirm(batch.invoices[0].id, buyer, 'forged'),
    ).rejects.toThrow('not found');
    await expect(
      invoices.get(batch.invoices[0].id, { userId: randomUUID() }),
    ).rejects.toThrow('not found');
    const first = batch.invoices.find((i) => i.vendorId === vendor)!;
    await invoices.report(
      first.id,
      { userId: buyer },
      { requestId: randomUUID(), reference: 'bank-transfer-one' },
    );
    expect((await invoices.get(first.id, { userId: buyer })).status).toBe(
      'PAYMENT_REPORTED',
    );
    expect(
      (
        await prisma.commerceOrder.findUniqueOrThrow({
          where: { id: batch.id },
        })
      ).paymentStatus,
    ).toBe('pending');
    const confirmed = await Promise.all([
      invoices.confirm(first.id, vendor, 'bank-credit-one'),
      invoices.confirm(first.id, vendor, 'bank-credit-one'),
    ]);
    expect(confirmed[0].receiptNumber).toBe(confirmed[1].receiptNumber);
    expect(confirmed[0].status).toBe('PAID');
    expect(
      (
        await prisma.commerceOrder.findUniqueOrThrow({
          where: { id: batch.id },
        })
      ).paymentStatus,
    ).toBe('partial');
    const second = batch.invoices.find((i) => i.vendorId === otherVendor)!;
    await invoices.confirm(second.id, otherVendor, 'bank-credit-two');
    expect(
      (
        await prisma.commerceOrder.findUniqueOrThrow({
          where: { id: batch.id },
        })
      ).paymentStatus,
    ).toBe('paid');
    expect(await prisma.walletTransaction.count()).toBe(0);
    const orders = new SellerOrdersService(prisma, new MockDeliveryProvider());
    await orders.transition(vendor, batch.id, 'processing');
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: product } }))
        .quantity,
    ).toBe(98);
    expect((await orders.detail(vendor, batch.id)).paymentStatus).toBe('paid');
    const finance = await new VendorsService(prisma).finance(vendor);
    expect(finance.platformFees).toBe(0);
    expect(finance.availableBalance).toBe(0);
    expect(finance.totalSales).toBe(5000);
  });
  it('keeps rejected reports unpaid, blocks dispatch, and releases reserved stock exactly once', async () => {
    const before = (
        await prisma.product.findUniqueOrThrow({ where: { id: product } })
      ).quantity,
      batch = await checkout(),
      id = batch.invoices[0].id;
    const reported = await invoices.report(
      id,
      { userId: buyer },
      { requestId: randomUUID(), reference: 'not-seen-in-bank' },
    );
    await invoices.rejectReport(
      id,
      vendor,
      reported.reports[0].id,
      'Transfer not received',
    );
    expect((await invoices.get(id, { userId: buyer })).status).toBe('OPEN');
    expect(
      (await invoices.get(id, { userId: buyer })).receiptNumber,
    ).toBeNull();
    const orders = new SellerOrdersService(prisma, new MockDeliveryProvider());
    await orders.transition(vendor, batch.id, 'processing');
    await expect(orders.transition(vendor, batch.id, 'ready')).rejects.toThrow(
      'payment',
    );
    await Promise.all([invoices.void(id, vendor), invoices.void(id, vendor)]);
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: product } }))
        .quantity,
    ).toBe(before);
    expect((await invoices.get(id, { userId: buyer })).status).toBe('VOID');
    const late = await invoices.confirm(id, vendor, 'late-bank-credit');
    expect(late.paymentIssue).toBe('RECEIVED_AFTER_CANCELLATION');
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: product } }))
        .quantity,
    ).toBe(before);
  });
  it('expires pending quotes, retains accepted and reported invoices, and never restocks dispatched goods', async () => {
    const expired = await checkout(),
      accepted = await checkout(),
      reported = await checkout();
    const orders = new SellerOrdersService(prisma, new MockDeliveryProvider());
    await orders.transition(vendor, accepted.id, 'processing');
    await invoices.report(
      reported.invoices[0].id,
      { userId: buyer },
      { requestId: randomUUID(), reference: 'bank-report' },
    );
    await prisma.goodsInvoice.updateMany({
      where: { orderId: { in: [expired.id, accepted.id, reported.id] } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await invoices.expire();
    expect(
      (await invoices.get(expired.invoices[0].id, { userId: buyer })).status,
    ).toBe('VOID');
    expect(
      (await invoices.get(accepted.invoices[0].id, { userId: buyer })).status,
    ).toBe('OPEN');
    expect(
      (await invoices.get(reported.invoices[0].id, { userId: buyer })).status,
    ).toBe('PAYMENT_REPORTED');
    await invoices.report(
      accepted.invoices[0].id,
      { userId: buyer },
      { requestId: randomUUID(), reference: 'accepted-bank-report' },
    );
    const rejected = await checkout();
    await orders.transition(vendor, rejected.id, 'rejected', 'Out of stock');
    expect(
      (
        await prisma.commerceOrder.findUniqueOrThrow({
          where: { id: rejected.id },
        })
      ).paymentStatus,
    ).toBe('cancelled');
    const dispatched = await checkout();
    await prisma.goodsInvoice.update({
      where: { id: dispatched.invoices[0].id },
      data: { paymentMethod: 'pay_on_delivery' },
    });
    for (const status of ['processing', 'ready', 'out_for_delivery'])
      await orders.transition(vendor, dispatched.id, status);
    const quantity = (
      await prisma.product.findUniqueOrThrow({ where: { id: product } })
    ).quantity;
    await expect(
      invoices.void(dispatched.invoices[0].id, vendor),
    ).rejects.toThrow('Dispatched');
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: product } }))
        .quantity,
    ).toBe(quantity);
  });
  it('requires the opaque guest token and preserves bank details from invoice issuance', async () => {
    const token = 'a'.repeat(64),
      key = randomUUID(),
      dto = {
        firstName: 'Guest',
        lastName: 'Shopper',
        email: 'guest@example.com',
        phone: '08012345678',
        paymentMethod: 'bank',
        address: { label: 'Guest delivery', latitude: 6.5, longitude: 3.3 },
        items: [{ productId: product, quantity: 1 }],
        guestAccessToken: token,
        idempotencyKey: key,
      };
    const batch = await commerce.guestCheckout(dto),
      id = batch.invoices[0].id;
    await expect(invoices.get(id, {})).rejects.toThrow('not found');
    await expect(
      invoices.get(id, { guestToken: 'b'.repeat(64) }),
    ).rejects.toThrow('not found');
    expect((await invoices.get(id, { guestToken: token })).customerName).toBe(
      'Guest Shopper',
    );
    await prisma.vendorProfile.update({
      where: { userId: vendor },
      data: { bankAccountNumber: '1111111111' },
    });
    expect((await invoices.get(id, { guestToken: token })).bank).toMatchObject({
      accountNumber: '1234567890',
    });
    expect((await commerce.guestCheckout(dto)).id).toBe(batch.id);
    await invoices.report(
      id,
      { guestToken: token },
      { requestId: randomUUID(), reference: 'guest-transfer' },
    );
    await invoices.confirm(id, vendor, 'guest-credit');
    expect(
      (await invoices.get(id, { guestToken: token })).receiptNumber,
    ).not.toBeNull();
  });
  it('only lets merchants invoice their own chat participants and products', async () => {
    const profile = await prisma.vendorProfile.findUniqueOrThrow({
        where: { userId: vendor },
      }),
      thread = await prisma.conversation.create({
        data: { buyerUserId: buyer, vendorProfileId: profile.id },
      }),
      dto = {
        requestId: randomUUID(),
        items: [{ productId: product, quantity: 1 }],
        deliveryAddress: 'Agreed delivery',
        deliveryFee: 200,
      };
    await expect(
      invoices.chatInvoice(otherVendor, thread.id, dto),
    ).rejects.toThrow('not found');
    await expect(
      invoices.chatInvoice(vendor, thread.id, {
        ...dto,
        items: [{ productId: otherProduct, quantity: 1 }],
      }),
    ).rejects.toThrow('own active products');
    const batch = await invoices.chatInvoice(vendor, thread.id, dto);
    expect(batch.total).toBe(2700);
    expect(
      await prisma.chatMessage.findFirst({
        where: { conversationId: thread.id, invoiceId: batch.invoices[0].id },
      }),
    ).not.toBeNull();
    expect((await invoices.chatInvoice(vendor, thread.id, dto)).id).toBe(
      batch.id,
    );
    await invoices.report(
      batch.invoices[0].id,
      { userId: buyer },
      { requestId: randomUUID(), reference: 'chat-bank-transfer' },
    );
    await Promise.all([
      invoices.confirm(batch.invoices[0].id, vendor, 'chat-credit'),
      invoices.confirm(batch.invoices[0].id, vendor, 'chat-credit'),
    ]);
    expect(
      await prisma.chatMessage.count({
        where: { conversationId: thread.id, invoiceId: batch.invoices[0].id },
      }),
    ).toBe(1);
    expect(
      await prisma.chatMessage.count({
        where: {
          conversationId: thread.id,
          text: { contains: 'Payment confirmed' },
        },
      }),
    ).toBe(1);
  });
  it('rejects platform wallet checkout and unconnected secure checkout', async () => {
    await expect(commerce.verifyPaystackPayment('unknown')).rejects.toThrow(
      'merchant invoice',
    );
    await expect(
      invoices.createCheckout({
        userId: buyer,
        address: { label: 'Test', latitude: 0, longitude: 0 },
        paymentMethod: 'wallet',
        lines: [],
        deliveryFee: 0,
      }),
    ).rejects.toThrow('directly');
    await expect(invoices.connect(vendor, merchantKey)).rejects.toThrow(
      'not available',
    );
  });
  it('uses the merchant key and verifies exact amounts and signed payment events', async () => {
    process.env.MERCHANT_PAYSTACK_CHECKOUT_ENABLED = 'true';
    provider = { payment_session_timeout: 30 };
    await expect(invoices.connect(vendor, platformKey)).rejects.toThrow(
      'own Paystack',
    );
    const connected = await invoices.connect(vendor, merchantKey);
    expect(JSON.stringify(connected)).not.toContain(merchantKey);
    const stored = await prisma.merchantPaymentConnection.findUniqueOrThrow({
      where: { id: connected.connection!.id },
    });
    expect(stored.encryptedKey).not.toContain(merchantKey);
    const batch = await checkout(),
      id = batch.invoices[0].id;
    provider = {
      authorization_url: 'https://checkout.paystack.com/test-merchant',
    };
    await invoices.secureCheckout(id, { userId: buyer });
    const invoice = await prisma.goodsInvoice.findUniqueOrThrow({
      where: { id },
    });
    const initialize = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).endsWith('/transaction/initialize'),
    )!;
    expect(initialize[1].headers.Authorization).toBe(`Bearer ${merchantKey}`);
    expect(JSON.parse(initialize[1].body).subaccount).toBeUndefined();
    provider = {
      status: 'success',
      reference: invoice.checkoutReference,
      amount: 1,
      currency: 'NGN',
      customer: { email: 'buyer@example.com' },
    };
    await expect(invoices.verify(id, { userId: buyer })).rejects.toThrow(
      'not been verified',
    );
    const raw = Buffer.from(
      JSON.stringify({
        event: 'charge.success',
        data: { reference: invoice.checkoutReference },
      }),
    );
    await expect(
      invoices.webhook(
        vendor,
        raw,
        '0'.repeat(128),
        JSON.parse(raw.toString()),
      ),
    ).rejects.toThrow('signature');
    provider = { ...provider, amount: invoice.total * 100 };
    await invoices.webhook(
      vendor,
      raw,
      createHmac('sha512', merchantKey).update(raw).digest('hex'),
      JSON.parse(raw.toString()),
    );
    await invoices.webhook(
      vendor,
      raw,
      createHmac('sha512', merchantKey).update(raw).digest('hex'),
      JSON.parse(raw.toString()),
    );
    expect((await invoices.get(id, { userId: buyer })).status).toBe('PAID');
    expect(await prisma.walletTransaction.count()).toBe(0);
  });
  it('enforces access and confirmation acknowledgement over HTTP', async () => {
    const batch = await checkout(),
      id = batch.invoices[0].id,
      module = await Test.createTestingModule({
        imports: [JwtModule.register({ secret: jwtSecret })],
        controllers: [GoodsInvoicesController, MerchantPaymentsController],
        providers: [{ provide: GoodsInvoicesService, useValue: invoices }],
      }).compile();
    const app = module.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    try {
      const jwt = module.get(JwtService),
        token = jwt.sign({ sub: buyer }),
        merchantToken = jwt.sign({ sub: vendor });
      await request(app.getHttpServer()).get(`/invoices/${id}`).expect(404);
      await request(app.getHttpServer())
        .get(`/invoices/${id}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/invoices/${id}/confirm`)
        .auth(token, { type: 'bearer' })
        .send({ reference: 'buyer-forged', received: true })
        .expect(404);
      await request(app.getHttpServer())
        .post(`/invoices/${id}/confirm`)
        .auth(merchantToken, { type: 'bearer' })
        .send({ reference: 'merchant-bank-credit', received: false })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/invoices/${id}/confirm`)
        .auth(merchantToken, { type: 'bearer' })
        .send({ reference: 'merchant-bank-credit', received: true })
        .expect(201);
    } finally {
      await app.close();
    }
  });
  it('authorizes wallet payments once, settles every merchant and preserves balances on errors', async () => {
    const batch = await checkout([product, otherProduct]);
    const wallets = new WalletService(prisma);
    await wallets.summary(buyer);
    await prisma.wallet.update({
      where: { userId: buyer },
      data: {
        availableBalance: 20000,
        mainBalance: 15000,
        referralBonus: 5000,
        pinHash: await bcrypt.hash('1234', 12),
        pinAttempts: 0,
        pinLockedUntil: null,
      },
    });
    const before = await Promise.all(
      [vendor, otherVendor].map(async (userId) => {
        await wallets.summary(userId);
        return prisma.wallet.findUniqueOrThrow({ where: { userId } });
      }),
    );
    await expect(
      invoices.payWallet(otherVendor, batch.id, {
        pin: '1234',
        expectedTotal: batch.total,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('not found');
    await expect(
      invoices.payWallet(buyer, batch.id, {
        pin: '1234',
        expectedTotal: 1,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('total has changed');
    await expect(
      invoices.payWallet(buyer, batch.id, {
        pin: '0000',
        expectedTotal: batch.total,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('Incorrect wallet PIN');
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { userId: buyer } }))
        .pinAttempts,
    ).toBe(1);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { userId: buyer } }))
        .availableBalance,
    ).toBe(20000);
    const result = await Promise.all(
      [1, 2].map(() =>
        invoices.payWallet(buyer, batch.id, {
          pin: '1234',
          expectedTotal: batch.total,
          requestId: randomUUID(),
        }),
      ),
    );
    expect(result.every((value) => value.paid)).toBe(true);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { userId: buyer } }))
        .availableBalance,
    ).toBe(20000 - batch.total);
    expect(
      await prisma.walletTransaction.count({
        where: { reference: `goods:${batch.id}:debit` },
      }),
    ).toBe(1);
    for (let i = 0; i < before.length; i++) {
      const invoice = batch.invoices.find(
        (invoice) => invoice.vendorId === before[i].userId,
      )!;
      const wallet = await prisma.wallet.findUniqueOrThrow({
        where: { id: before[i].id },
      });
      expect(wallet.availableBalance).toBe(
        before[i].availableBalance + invoice.total,
      );
      expect(wallet.mainBalance).toBe(before[i].mainBalance + invoice.total);
      expect(
        (await invoices.get(invoice.id, { userId: buyer })).paymentMethod,
      ).toBe('wallet');
    }
    const another = await checkout([product]);
    await prisma.wallet.update({
      where: { userId: buyer },
      data: { availableBalance: 1, mainBalance: 1, referralBonus: 0 },
    });
    await expect(
      invoices.payWallet(buyer, another.id, {
        pin: '1234',
        expectedTotal: another.total,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('Insufficient');
    expect(
      (await invoices.get(another.invoices[0].id, { userId: buyer })).status,
    ).toBe('OPEN');
    await prisma.wallet.update({
      where: { userId: buyer },
      data: { pinAttempts: 4 },
    });
    await expect(
      invoices.payWallet(buyer, another.id, {
        pin: '0000',
        expectedTotal: another.total,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('locked');
    await expect(
      invoices.payWallet(buyer, another.id, {
        pin: '1234',
        expectedTotal: another.total,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('locked');
  });
  it('sets and recovers wallet PINs using a separate one-use contact challenge', async () => {
    const saved = {
      key: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM,
    };
    const wallets = new WalletService(prisma);
    try {
      process.env.RESEND_API_KEY = 'test-provider-key';
      process.env.EMAIL_FROM = 'test@example.com';
      const challenge = await wallets.requestPin(buyer, 'email');
      const calls = (global.fetch as jest.Mock).mock.calls;
      const call = [...calls]
        .reverse()
        .find((call) => String(call[0]).includes('resend.com'))!;
      const code = JSON.parse(call[1].body).text.match(/\b\d{6}\b/)[0];
      await expect(
        wallets.setPin(otherVendor, {
          challengeId: challenge.challengeId,
          pin: '5678',
          code,
        }),
      ).rejects.toThrow('new wallet verification');
      await wallets.setPin(buyer, {
        challengeId: challenge.challengeId,
        pin: '5678',
        code,
      });
      const wallet = await prisma.wallet.findUniqueOrThrow({
        where: { userId: buyer },
      });
      expect(wallet.pinHash).not.toBe('5678');
      expect(await bcrypt.compare('5678', wallet.pinHash!)).toBe(true);
      expect(wallet.pinAttempts).toBe(0);
      expect(wallet.pinLockedUntil).toBeNull();
      await expect(
        wallets.setPin(buyer, {
          challengeId: challenge.challengeId,
          pin: '1234',
          code,
        }),
      ).rejects.toThrow('new wallet verification');
      expect(await wallets.summary(buyer)).not.toHaveProperty('pinHash');
    } finally {
      if (saved.key === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = saved.key;
      if (saved.from === undefined) delete process.env.EMAIL_FROM;
      else process.env.EMAIL_FROM = saved.from;
    }
  });
  it('creates merchant orders with variants, pending payment and honest delivery statuses; retries never duplicate', async () => {
    const saved = {
      key: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM,
    };
    process.env.RESEND_API_KEY = 'test-provider-key';
    process.env.EMAIL_FROM = 'test@example.com';
    const variantProduct = await prisma.product.create({
      data: {
        vendorProfileId: (
          await prisma.vendorProfile.findUniqueOrThrow({
            where: { userId: vendor },
          })
        ).id,
        category: 'Bags',
        name: 'Variant bag',
        unitPrice: 2000,
        quantity: 4,
        imageUrls: [],
        variants: [{ options: { Color: 'Brown', Size: 'Large' }, quantity: 4 }],
      },
    });
    const dto = {
      requestId: randomUUID(),
      guestAccessToken: randomBytes(32).toString('hex'),
      items: [
        {
          productId: variantProduct.id,
          quantity: 2,
          selectedVariants: { Color: 'Brown', Size: 'Large' },
        },
      ],
      buyer: { name: 'Guest Buyer', email: 'guest@example.com' },
      channels: ['email' as const],
      deliveryAddress: 'Agreed delivery in Lagos',
      deliveryFee: 500,
    };
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: 'email-accepted' }),
    }));
    try {
      const first = await invoices.createMerchantOrder(vendor, dto);
      expect(first.total).toBe(4500);
      expect(first.paymentStatus).toBe('pending');
      expect(first.deliveries[0].status).toBe('SENT');
      expect(first.invoice.items[0].selectedVariants).toEqual({
        Color: 'Brown',
        Size: 'Large',
      });
      const count = fetchMock.mock.calls.length;
      const repeated = await invoices.createMerchantOrder(vendor, dto);
      expect(repeated.id).toBe(first.id);
      expect(fetchMock.mock.calls.length).toBe(count);
      expect(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: variantProduct.id },
          })
        ).quantity,
      ).toBe(2);
      await expect(
        invoices.createMerchantOrder(otherVendor, {
          ...dto,
          requestId: randomUUID(),
        }),
      ).rejects.toThrow('own active products');
      await expect(
        invoices.createMerchantOrder(vendor, {
          ...dto,
          requestId: randomUUID(),
          items: [{ ...dto.items[0], selectedVariants: {} }],
        }),
      ).rejects.toThrow('Choose an available option');
      fetchMock.mockImplementation(async () => ({
        ok: false,
        json: async () => ({}),
      }));
      const failed = await invoices.createMerchantOrder(vendor, {
        ...dto,
        requestId: randomUUID(),
        items: [{ ...dto.items[0], quantity: 1 }],
      });
      expect(failed.deliveries[0].status).toBe('FAILED');
      expect(failed.paymentStatus).toBe('pending');
    } finally {
      if (saved.key === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = saved.key;
      if (saved.from === undefined) delete process.env.EMAIL_FROM;
      else process.env.EMAIL_FROM = saved.from;
    }
  });
  it('enforces wallet owner and PIN request validation at the HTTP boundary', async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [WalletController],
      providers: [
        { provide: WalletService, useValue: new WalletService(prisma) },
        { provide: GoodsInvoicesService, useValue: invoices },
      ],
    }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    try {
      const token = module.get(JwtService).sign({ sub: buyer });
      await request(app.getHttpServer())
        .get(`/users/${buyer}/wallet`)
        .expect(401);
      await request(app.getHttpServer())
        .get(`/users/${otherVendor}/wallet`)
        .auth(token, { type: 'bearer' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/users/${buyer}/wallet/orders/${randomUUID()}/pay`)
        .auth(token, { type: 'bearer' })
        .send({ pin: '123', expectedTotal: 10, requestId: randomUUID() })
        .expect(400);
    } finally {
      await app.close();
    }
  });
});
