import { ReferralRewardsService } from '../referrals/referral-rewards.service';
import { existingOrNewThread } from '../messaging/conversation-thread';
import {
  storedVariants,
  variantIndex,
  variantImage,
} from '../common/product-options';
import { MerchantOrderInvoiceDto } from './invoice.dto';
import { normalizePhone } from '../auth/phone/normalize-phone';
import { deliverInvoice } from './invoice-delivery';
import * as bcrypt from 'bcrypt';
import {
  applyOfferPricing,
  deliveryOfferFee,
  releaseOfferUnits,
} from '../vendors/offer-pricing';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from 'prisma/prisma.service';
import { Prisma } from 'generated/prisma/client';
import {
  lockOrder,
  syncOrder,
  reconcileInvoicePayments,
} from '../commerce/fulfillment';
export type InvoiceAccess = { userId?: string; guestToken?: string };
export type InvoiceLine = {
  productId: string;
  vendorId: string;
  vendorName: string;
  name: string;
  subtitle: string;
  imageUri: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  originalPrice: number | null;
  selectedColor: string | null;
  selectedSize: string | null;
  selectedVariants: Prisma.InputJsonValue;
  deliveryAddress: string;
  sourceCartItemId?: string | null;
};
const invoiceInclude = {
  order: {
    include: {
      items: true,
      user: {
        select: { firstName: true, lastName: true, email: true, phone: true },
      },
    },
  },
  vendorProfile: { select: { storeName: true, userId: true } },
  reports: {
    orderBy: { createdAt: 'desc' as const },
    include: { evidence: { select: { id: true, name: true, mime: true } } },
  },
  deliveries: true,
} satisfies Prisma.GoodsInvoiceInclude;
type InvoiceRecord = Prisma.GoodsInvoiceGetPayload<{
  include: typeof invoiceInclude;
}>;
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
@Injectable()
export class GoodsInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly referralRewards?: ReferralRewardsService,
  ) {}
  async walletOrder(userId: string, orderId: string) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id: orderId, userId },
      include: { invoices: true },
    });
    if (!order) throw new NotFoundException('Order not found.');
    const debit = await this.prisma.walletTransaction.findUnique({
      where: { reference: `goods:${orderId}:debit` },
      select: { amount: true },
    });
    return {
      id: order.id,
      paymentMethod: order.paymentMethod,
      walletPaidTotal: debit ? Math.abs(debit.amount) : null,
      total: order.invoices
        .filter((i) => i.status !== 'PAID')
        .reduce((sum, i) => sum + i.total, 0),
      originalTotal: order.total,
      paymentStatus: order.paymentStatus,
      deliveryAddress: order.deliveryAddress,
      invoices: order.invoices.map((i) => ({
        id: i.id,
        number: i.number,
        total: i.total,
        status: i.status,
      })),
    };
  }
  async payWallet(
    userId: string,
    orderId: string,
    dto: { pin: string; expectedTotal: number; requestId: string },
  ) {
    const result = await this.transaction(async (tx) => {
      await lockOrder(tx, orderId);
      const order = await tx.commerceOrder.findFirst({
        where: { id: orderId, userId, user: { isActive: true } },
        include: { invoices: true },
      });
      if (!order) throw new NotFoundException('Order not found.');
      if (
        order.invoices.length &&
        order.invoices.every((i) => i.status === 'PAID')
      ) {
        const debit = await tx.walletTransaction.findUnique({
          where: { reference: `goods:${orderId}:debit` },
        });
        if (!debit)
          throw new BadRequestException(
            'This order has already been paid using another payment method.',
          );
        return { paid: true, orderId, total: Math.abs(debit.amount) };
      }
      const unpaid = order.invoices.filter((i) => i.status !== 'PAID');
      if (
        !unpaid.length ||
        unpaid.some(
          (i) =>
            i.status !== 'OPEN' ||
            i.checkoutReference ||
            i.expiresAt <= new Date(),
        )
      )
        throw new BadRequestException(
          'Review your invoices before paying. A payment may already be in progress or an invoice may have expired.',
        );
      if (order.invoices.some((i) => i.vendorId === userId))
        throw new BadRequestException(
          'You cannot pay your own merchant invoice.',
        );
      const total = unpaid.reduce((sum, i) => sum + i.total, 0);
      if (total !== dto.expectedTotal)
        throw new BadRequestException(
          'The total has changed. Review your invoices before paying.',
        );
      const participants = [
        ...new Set([userId, ...order.invoices.map((i) => i.vendorId)]),
      ].sort();
      for (const id of participants) {
        await tx.wallet.upsert({
          where: { userId: id },
          create: { userId: id },
          update: {},
        });
        await tx.$queryRaw`SELECT "id" FROM "Wallet" WHERE "userId" = ${id} FOR UPDATE`;
      }
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      if (!wallet.pinHash)
        return { error: 'Set up your wallet PIN before paying.' };
      if (wallet.pinLockedUntil && wallet.pinLockedUntil > new Date())
        return {
          error:
            'Your wallet PIN is locked. Try again in 15 minutes or reset your PIN.',
        };
      if (!(await bcrypt.compare(dto.pin, wallet.pinHash))) {
        const attempts =
          (wallet.pinLockedUntil && wallet.pinLockedUntil <= new Date()
            ? 0
            : wallet.pinAttempts) + 1;
        await tx.wallet.update({
          where: { userId },
          data: {
            pinAttempts: attempts,
            pinLockedUntil:
              attempts >= 5 ? new Date(Date.now() + 15 * 60000) : null,
          },
        });
        return {
          error:
            attempts >= 5
              ? 'Your wallet PIN is locked for 15 minutes.'
              : 'Incorrect wallet PIN. Please try again.',
        };
      }
      await tx.wallet.update({
        where: { userId },
        data: { pinAttempts: 0, pinLockedUntil: null },
      });
      if (wallet.availableBalance < total)
        return {
          error: 'Insufficient wallet balance. Choose another payment method.',
        };
      const mainDebit = Math.min(wallet.mainBalance, total);
      await tx.wallet.update({
        where: { userId },
        data: {
          availableBalance: { decrement: total },
          mainBalance: { decrement: mainDebit },
          referralBonus: Math.max(
            0,
            wallet.referralBonus - (total - mainDebit),
          ),
          pinAttempts: 0,
          pinLockedUntil: null,
        },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: -total,
          type: 'PURCHASE',
          reference: `goods:${orderId}:debit`,
          description: `Payment for order ${orderId}`,
        },
      });
      for (const invoice of unpaid) {
        const merchant = await tx.wallet.update({
          where: { userId: invoice.vendorId },
          data: {
            availableBalance: { increment: invoice.total },
            mainBalance: { increment: invoice.total },
          },
        });
        await tx.walletTransaction.create({
          data: {
            walletId: merchant.id,
            amount: invoice.total,
            type: 'FUNDING',
            reference: `goods:${invoice.id}:credit`,
            description: `Merchant settlement for invoice ${invoice.number}`,
          },
        });
        await tx.goodsInvoice.update({
          where: { id: invoice.id },
          data: {
            status: 'PAID',
            paidAt: new Date(),
            paymentMethod: 'wallet',
            receiptNumber: `RCT-${randomUUID().toUpperCase()}`,
            confirmationReference: `WALLET-${dto.requestId}`,
          },
        });
        await this.event(
          tx,
          invoice,
          'Wallet payment received. Your receipt is available on Whazzonline.',
          userId,
        );
      }
      await tx.commerceOrder.update({
        where: { id: orderId },
        data: { paymentMethod: 'wallet' },
      });
      await reconcileInvoicePayments(tx, orderId);
      return { paid: true, orderId, total };
    });
    // Failed PIN attempts must commit before the error is returned.
    if ('error' in result) throw new BadRequestException(result.error);
    return result;
  }
  private async transaction<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let i = 0; i < 4; i++)
      try {
        return await this.prisma.$transaction(run, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (e) {
        if (
          !(e instanceof Prisma.PrismaClientKnownRequestError) ||
          (e.code !== 'P2034' &&
            !(
              e.code === 'P2010' &&
              /40001|40P01/.test(JSON.stringify(e.meta ?? {}))
            )) ||
          i === 3
        )
          throw e;
      }
    throw new ServiceUnavailableException('Please retry this action.');
  }
  private assertAccess(invoice: InvoiceRecord, access: InvoiceAccess) {
    if (
      access.userId &&
      (invoice.order.userId === access.userId ||
        invoice.vendorId === access.userId)
    )
      return;
    if (
      !invoice.order.userId &&
      access.guestToken &&
      invoice.order.guestInvoiceTokenHash === hash(access.guestToken)
    )
      return;
    throw new NotFoundException('Invoice not found.');
  }
  private map(invoice: InvoiceRecord, access: InvoiceAccess) {
    const { order } = invoice;
    return {
      id: invoice.id,
      number: invoice.number,
      orderId: invoice.orderId,
      orderTotal: order.total,
      merchantId: invoice.vendorId,
      merchantName: invoice.vendorProfile.storeName,
      bank: invoice.bank,
      subtotal: invoice.subtotal,
      deliveryFee: invoice.deliveryFee,
      total: invoice.total,
      currency: 'NGN',
      status: invoice.status,
      paymentMethod: invoice.paymentMethod,
      createdAt: invoice.createdAt,
      expiresAt: invoice.expiresAt,
      paidAt: invoice.paidAt,
      paymentIssue: invoice.paymentIssue,
      receiptNumber: invoice.receiptNumber,
      confirmationReference: invoice.confirmationReference,
      customerName: order.user
        ? [order.user.firstName, order.user.lastName].filter(Boolean).join(' ')
        : [order.guestFirstName, order.guestLastName].filter(Boolean).join(' '),
      customerEmail: order.user?.email ?? order.guestEmail,
      customerPhone: order.user?.phone ?? order.guestPhone,
      merchantProfileId: invoice.vendorProfileId,
      deliveryAddress: order.deliveryAddress,
      recipient: invoice.recipient,
      deliveries: invoice.deliveries,
      items: order.items.filter((i) => i.vendorId === invoice.vendorId),
      reports: invoice.reports,
      isMerchant: access.userId === invoice.vendorId,
      secureCheckoutAvailable:
        process.env.MERCHANT_PAYSTACK_CHECKOUT_ENABLED === 'true',
    };
  }
  async get(id: string, access: InvoiceAccess) {
    let invoice = await this.prisma.goodsInvoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    this.assertAccess(invoice, access);
    if (
      invoice.status !== 'PAID' &&
      invoice.status !== 'VOID' &&
      invoice.expiresAt < new Date()
    ) {
      await this.void(id, null, true);
      invoice = (await this.prisma.goodsInvoice.findUnique({
        where: { id },
        include: invoiceInclude,
      }))!;
    }
    const result = this.map(invoice, access);
    const connected = await this.prisma.merchantPaymentConnection.count({
      where: { vendorProfileId: invoice.vendorProfileId, enabled: true },
    });
    const orderInvoices = await this.prisma.goodsInvoice.findMany({
      where: { orderId: invoice.orderId },
      select: {
        status: true,
        total: true,
        checkoutReference: true,
        expiresAt: true,
      },
    });
    const unpaid = orderInvoices.filter((i) => i.status !== 'PAID');
    return {
      ...result,
      walletPaymentTotal: unpaid.reduce((sum, i) => sum + i.total, 0),
      walletPaymentAvailable:
        !!access.userId &&
        access.userId === invoice.order.userId &&
        unpaid.length > 0 &&
        unpaid.every(
          (i) =>
            i.status === 'OPEN' &&
            !i.checkoutReference &&
            i.expiresAt > new Date(),
        ),
      secureCheckoutAvailable: result.secureCheckoutAvailable && connected > 0,
    };
  }
  async resume(
    userId: string | undefined,
    key: string | undefined,
    guestToken?: string,
  ) {
    if (!key) return null;
    const order = await this.prisma.commerceOrder.findUnique({
      where: { checkoutKey: `${userId ?? 'guest'}:${key}` },
      include: { invoices: true },
    });
    if (!order) return null;
    if (
      !userId &&
      (!guestToken || order.guestInvoiceTokenHash !== hash(guestToken))
    )
      throw new NotFoundException('Checkout not found.');
    return {
      id: order.id,
      total: order.total,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      reference: order.paymentReference,
      authorizationUrl: null,
      invoices: order.invoices.map((i) => ({
        id: i.id,
        number: i.number,
        vendorId: i.vendorId,
        total: i.total,
        status: i.status,
      })),
      guestAccessToken: guestToken,
    };
  }

  async quote(input: {
    items: { productId: string; quantity: number }[];
    deliveryAddress?: string;
    deliveryFee?: number;
  }) {
    const quantities = new Map<string, number>();
    for (const item of input.items)
      quantities.set(
        item.productId,
        (quantities.get(item.productId) ?? 0) + item.quantity,
      );
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: [...quantities.keys()] },
        status: 'ACTIVE',
        vendorProfile: { setupCompleted: true, user: { isActive: true } },
      },
      include: { vendorProfile: { select: { userId: true, storeName: true } } },
    });
    if (products.length !== quantities.size)
      throw new BadRequestException(
        'A selected product is no longer available.',
      );
    const now = new Date();
    const vendorIds = [
      ...new Set(products.map((p) => p.vendorProfile.userId)),
    ].sort();
    const offers = await this.prisma.offer.findMany({
      where: {
        status: { in: ['ACTIVE', 'SCHEDULED'] },
        startsAt: { lte: now },
        endsAt: { gt: now },
        vendorProfile: { userId: { in: vendorIds } },
        products: { some: { productId: { in: [...quantities.keys()] } } },
      },
      include: { products: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const lines = products.map((p) => {
      const quantity = quantities.get(p.id)!;
      if (quantity > p.quantity)
        throw new BadRequestException(`${p.name} does not have enough stock.`);
      return {
        productId: p.id,
        vendorId: p.vendorProfile.userId,
        vendorName: p.vendorProfile.storeName,
        name: p.name,
        subtitle: p.category,
        imageUri: p.imageUrls[0] ?? '',
        sku: p.id,
        unitPrice: p.unitPrice,
        quantity,
        originalPrice: null,
        selectedColor: null,
        selectedSize: null,
        selectedVariants: {},
        deliveryAddress: input.deliveryAddress ?? '',
      };
    });
    const priced = applyOfferPricing(lines, products, offers, now).lines;
    const originalSubtotal = lines.reduce(
      (sum, line) => sum + line.unitPrice * line.quantity,
      0,
    );
    const subtotal = priced.reduce(
      (sum, line) => sum + line.unitPrice * line.quantity,
      0,
    );
    let deliveryFee = 0;
    vendorIds.forEach((vendorId, index) => {
      const vendorLines = priced.filter((line) => line.vendorId === vendorId);
      const fee =
        Math.floor((input.deliveryFee ?? 0) / vendorIds.length) +
        (index < (input.deliveryFee ?? 0) % vendorIds.length ? 1 : 0);
      deliveryFee += deliveryOfferFee(
        fee,
        vendorLines.reduce(
          (sum, line) => sum + line.unitPrice * line.quantity,
          0,
        ),
        vendorLines.map((line) => line.productId),
        offers,
        input.deliveryAddress ?? '',
        now,
      );
    });
    return {
      items: priced.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        originalPrice: line.originalPrice,
        appliedOfferId: line.appliedOfferId,
      })),
      originalSubtotal,
      subtotal,
      discount: originalSubtotal - subtotal,
      deliveryFee,
      serviceFee: 0,
      total: subtotal + deliveryFee,
      quotedAt: now.toISOString(),
    };
  }
  async createCheckout(input: {
    userId?: string;
    guest?: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
    };
    guestAccessToken?: string;
    idempotencyKey?: string;
    address: { label: string; latitude: number; longitude: number };
    paymentMethod: string;
    lines: InvoiceLine[];
    deliveryFee: number;
    conversationId?: string;
    recipient?: Prisma.InputJsonValue;
  }) {
    if (!['bank', 'card', 'pay_on_delivery'].includes(input.paymentMethod))
      throw new BadRequestException(
        'Goods payments go directly to the merchant. Choose bank transfer or a connected merchant checkout.',
      );
    if (!input.lines.length)
      throw new BadRequestException('Your cart is empty.');
    const vendorIds = [...new Set(input.lines.map((i) => i.vendorId))].sort();
    const profiles = await this.prisma.vendorProfile.findMany({
      where: { userId: { in: vendorIds } },
      select: {
        id: true,
        userId: true,
        bankAccountName: true,
        bankAccountNumber: true,
        bankName: true,
        bankCode: true,
        setupCompleted: true,
        paymentConnections: { where: { enabled: true }, select: { id: true } },
      },
    });
    for (const id of vendorIds) {
      const profile = profiles.find((p) => p.userId === id);
      if (
        !profile?.setupCompleted ||
        !profile.bankAccountName ||
        !profile.bankAccountNumber ||
        !profile.bankName
      )
        throw new BadRequestException(
          'A merchant has not completed their payment account. Ask them to add their bank details before requesting an invoice.',
        );
      if (
        input.paymentMethod === 'card' &&
        (process.env.MERCHANT_PAYSTACK_CHECKOUT_ENABLED !== 'true' ||
          !profile.paymentConnections.length)
      )
        throw new BadRequestException(
          'Secure checkout is not connected for every merchant. Use bank transfer invoices.',
        );
    }
    const guestToken = input.userId
      ? undefined
      : (input.guestAccessToken ?? randomBytes(32).toString('hex'));
    const checkoutKey = input.idempotencyKey
      ? `${input.userId ?? 'guest'}:${input.idempotencyKey}`
      : null;
    const receipt = (order: {
      id: string;
      total: number;
      paymentReference: string | null;
      invoices: {
        id: string;
        number: string;
        vendorId: string;
        total: number;
        status: string;
      }[];
    }) => ({
      id: order.id,
      total: order.total,
      paymentStatus: 'pending',
      paymentMethod: input.paymentMethod,
      reference: order.paymentReference,
      authorizationUrl: null,
      invoices: order.invoices.map((i) => ({
        id: i.id,
        number: i.number,
        vendorId: i.vendorId,
        total: i.total,
        status: i.status,
      })),
      guestAccessToken: guestToken,
    });
    if (checkoutKey) {
      const existing = await this.prisma.commerceOrder.findUnique({
        where: { checkoutKey },
        include: { invoices: true },
      });
      if (existing) {
        if (
          !input.userId &&
          existing.guestInvoiceTokenHash !== hash(guestToken!)
        )
          throw new NotFoundException('Checkout not found.');
        return receipt(existing);
      }
    }
    try {
      return await this.transaction(async (tx) => {
        const now = new Date();
        const products = await tx.product.findMany({
          where: { id: { in: input.lines.map((l) => l.productId) } },
        });
        const offers = await tx.offer.findMany({
          where: {
            status: { in: ['ACTIVE', 'SCHEDULED'] },
            startsAt: { lte: now },
            endsAt: { gt: now },
            vendorProfile: { userId: { in: vendorIds } },
            products: {
              some: { productId: { in: input.lines.map((l) => l.productId) } },
            },
          },
          include: { products: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const { lines: pricedLines, claimed } = applyOfferPricing(
          input.lines,
          products,
          offers,
          now,
        );
        for (const [id, units] of [...claimed].sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          const offer = offers.find((o) => o.id === id)!;
          const updated = await tx.offer.updateMany({
            where: { id, unitsClaimed: { lte: offer.stockLimit! - units } },
            data: { unitsClaimed: { increment: units } },
          });
          if (updated.count !== 1)
            throw new BadRequestException(
              'Offer stock changed. Refresh your cart and try again.',
            );
        }
        const merchantFees = new Map(
          vendorIds.map((vendorId, index) => {
            const fee =
              Math.floor(input.deliveryFee / vendorIds.length) +
              (index < input.deliveryFee % vendorIds.length ? 1 : 0);
            const vendorLines = pricedLines.filter(
              (l) => l.vendorId === vendorId,
            );
            const subtotal = vendorLines.reduce(
              (sum, l) => sum + l.unitPrice * l.quantity,
              0,
            );
            const vendorOffers = offers.filter((o) =>
              vendorLines.some((l) =>
                o.products.some((p) => p.productId === l.productId),
              ),
            );
            return [
              vendorId,
              deliveryOfferFee(
                fee,
                subtotal,
                vendorLines.map((l) => l.productId),
                vendorOffers,
                input.address.label,
                now,
              ),
            ] as const;
          }),
        );
        const deliveryTotal = [...merchantFees.values()].reduce(
          (a, b) => a + b,
          0,
        );

        const quantities = new Map<string, number>();
        for (const line of pricedLines)
          quantities.set(
            line.productId,
            (quantities.get(line.productId) ?? 0) + line.quantity,
          );
        for (const product of products) {
          const variants = storedVariants(product.variants);
          if (!variants.length) continue;
          for (const line of pricedLines.filter(
            (l) => l.productId === product.id,
          )) {
            const index = variantIndex(
              variants,
              line.selectedVariants,
              line.selectedColor,
              line.selectedSize,
            );
            if (index < 0)
              throw new BadRequestException(
                `Choose an available option for ${product.name}.`,
              );
            if (variants[index].quantity < line.quantity)
              throw new BadRequestException(
                `The selected option for ${product.name} does not have enough stock.`,
              );
            variants[index] = {
              ...variants[index],
              quantity: variants[index].quantity - line.quantity,
            };
          }
          await tx.product.update({
            where: { id: product.id },
            data: { variants: variants as Prisma.InputJsonValue },
          });
        }
        for (const [productId, quantity] of [...quantities].sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          const changed = await tx.product.updateMany({
            where: {
              id: productId,
              status: 'ACTIVE',
              quantity: { gte: quantity },
              vendorProfile: { user: { isActive: true }, setupCompleted: true },
            },
            data: { quantity: { decrement: quantity } },
          });
          if (!changed.count)
            throw new BadRequestException(
              'An item no longer has enough stock. Refresh your cart.',
            );
        }
        const subtotal = pricedLines.reduce(
            (sum, i) => sum + i.quantity * i.unitPrice,
            0,
          ),
          total = subtotal + deliveryTotal;
        const order = await tx.commerceOrder.create({
          data: {
            userId: input.userId,
            guestFirstName: input.guest?.firstName,
            guestLastName: input.guest?.lastName,
            guestEmail: input.guest?.email,
            guestPhone: input.guest?.phone,
            guestInvoiceTokenHash: guestToken ? hash(guestToken) : null,
            checkoutKey,
            paymentReference: `INVOICE-${randomUUID()}`,
            deliveryAddress: input.address.label,
            latitude: input.address.latitude,
            longitude: input.address.longitude,
            paymentMethod: input.paymentMethod,
            paymentStatus: 'pending',
            status: 'confirmed',
            serviceFee: 0,
            deliveryFee: deliveryTotal,
            subtotal,
            total,
            items: { create: pricedLines },
          },
        });
        for (let index = 0; index < vendorIds.length; index++) {
          const vendorId = vendorIds[index],
            profile = profiles.find((p) => p.userId === vendorId)!,
            deliveryFee = merchantFees.get(vendorId)!,
            merchantSubtotal = pricedLines
              .filter((i) => i.vendorId === vendorId)
              .reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
          const invoice = await tx.goodsInvoice.create({
            data: {
              number: `INV-${randomUUID().toUpperCase()}`,
              orderId: order.id,
              vendorId,
              vendorProfileId: profile.id,
              bank: {
                accountName: profile.bankAccountName,
                accountNumber: profile.bankAccountNumber,
                bankName: profile.bankName,
                bankCode: profile.bankCode,
              },
              subtotal: merchantSubtotal,
              deliveryFee,
              total: merchantSubtotal + deliveryFee,
              paymentMethod: input.paymentMethod,
              recipient: input.recipient,
              expiresAt: new Date(Date.now() + 7 * 86400000),
            },
          });
          await tx.sellerFulfillment.create({
            data: {
              orderId: order.id,
              vendorId,
              status: 'pending',
              history: {
                create: {
                  status: 'pending',
                  actorUserId: input.userId,
                  reason: `Invoice ${invoice.number} issued. Payment pending.`,
                },
              },
            },
          });
          if (input.userId) {
            const conversation = input.conversationId
              ? await tx.conversation.findFirst({
                  where: {
                    id: input.conversationId,
                    buyerUserId: input.userId,
                    vendorProfileId: profile.id,
                  },
                })
              : await existingOrNewThread(tx, input.userId, profile.id, `Invoice ${invoice.number}`);
            if (!conversation)
              throw new ForbiddenException(
                'Invoice conversation does not match.',
              );
            await tx.chatMessage.create({
              data: {
                conversationId: conversation.id,
                senderUserId: vendorId,
                kind: 'TEXT',
                invoiceId: invoice.id,
                text: `Invoice ${invoice.number}: ₦${invoice.total.toLocaleString('en-NG')}. Pay directly to the merchant account shown on the invoice.`,
              },
            });
            await tx.conversation.update({
              where: { id: conversation.id },
              data: { updatedAt: new Date(), latestOrderId: order.id },
            });
          }
        }
        if (input.userId) {
          const ids = pricedLines
            .map((i) => i.sourceCartItemId)
            .filter((id): id is string => !!id);
          if (ids.length)
            await tx.commerceCartItem.deleteMany({
              where: { userId: input.userId, id: { in: ids } },
            });
        }
        return receipt(
          await tx.commerceOrder.findUniqueOrThrow({
            where: { id: order.id },
            include: { invoices: true },
          }),
        );
      });
    } catch (error) {
      if (
        checkoutKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.commerceOrder.findUnique({
          where: { checkoutKey },
          include: { invoices: true },
        });
        if (
          existing &&
          (input.userId || existing.guestInvoiceTokenHash === hash(guestToken!))
        )
          return receipt(existing);
      }
      throw error;
    }
  }
  async report(
    id: string,
    access: InvoiceAccess,
    dto: {
      requestId: string;
      reference?: string;
      note?: string;
      remitterName?: string;
      transferAmount?: number;
    },
    evidence: { name: string; mime: string; content: Buffer }[] = [],
  ) {
    const invoice = await this.prisma.goodsInvoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    this.assertAccess(invoice, access);
    await this.get(id, access);
    if (access.userId === invoice.vendorId)
      throw new ForbiddenException('Only the buyer can report their transfer.');
    if (!dto.reference?.trim() && !evidence.length)
      throw new BadRequestException(
        'Attach transfer evidence or enter a transaction reference.',
      );
    await this.transaction(async (tx) => {
      await lockOrder(tx, invoice.orderId);
      const current = await tx.goodsInvoice.findUniqueOrThrow({
        where: { id },
      });
      if (current.status === 'PAID' || current.status === 'VOID')
        throw new BadRequestException(
          'This invoice cannot accept a transfer report.',
        );
      if (current.checkoutReference)
        throw new BadRequestException(
          'Secure payment already started. Verify that payment instead.',
        );
      const reported = await tx.invoiceTransferReport.findUnique({
        where: {
          invoiceId_requestId: { invoiceId: id, requestId: dto.requestId },
        },
      });
      if (reported) {
        if (reported.status !== 'PENDING')
          throw new BadRequestException(
            'This report was already reviewed. Send a new report.',
          );
        return;
      }
      if (current.status === 'PAYMENT_REPORTED')
        throw new BadRequestException(
          'A transfer report is already awaiting merchant confirmation.',
        );
      await tx.invoiceTransferReport.upsert({
        where: {
          invoiceId_requestId: { invoiceId: id, requestId: dto.requestId },
        },
        create: {
          invoiceId: id,
          requestId: dto.requestId,
          reference: dto.reference?.trim() ?? '',
          remitterName: dto.remitterName?.trim(),
          transferAmount: dto.transferAmount,
          note: dto.note?.trim(),
          evidence: {
            create: evidence.map((file) => ({
              ...file,
              content: Uint8Array.from(file.content),
            })),
          },
        },
        update: {},
      });
      await tx.goodsInvoice.update({
        where: { id },
        data: { status: 'PAYMENT_REPORTED' },
      });
      await this.event(
        tx,
        invoice,
        'Buyer reported a bank transfer. Check your bank before confirming.',
        access.userId ?? null,
      );
    });
    return this.get(id, access);
  }
  async transferEvidence(
    id: string,
    evidenceId: string,
    access: InvoiceAccess,
  ) {
    const invoice = await this.prisma.goodsInvoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    this.assertAccess(invoice, access);
    const evidence = await this.prisma.invoiceTransferEvidence.findFirst({
      where: { id: evidenceId, report: { invoiceId: id } },
    });
    if (!evidence) throw new NotFoundException('Evidence not found.');
    return evidence;
  }
  private async event(
    tx: Prisma.TransactionClient,
    invoice: { id: string; orderId: string; vendorId: string; number: string },
    reason: string,
    actorUserId: string | null,
  ) {
    const fulfillment = await tx.sellerFulfillment.findUnique({
      where: {
        orderId_vendorId: {
          orderId: invoice.orderId,
          vendorId: invoice.vendorId,
        },
      },
    });
    if (fulfillment)
      await tx.sellerFulfillmentEvent.create({
        data: {
          fulfillmentId: fulfillment.id,
          status: fulfillment.status,
          reason,
          actorUserId,
        },
      });
    const conversations = await tx.conversation.findMany({
      where: { messages: { some: { invoiceId: invoice.id } } },
      select: { id: true },
    });
    for (const c of conversations) {
      await tx.chatMessage.create({
        data: {
          conversationId: c.id,
          senderUserId: invoice.vendorId,
          kind: 'TEXT',
          text: `Payment update for invoice ${invoice.number}: ${reason}`,
        },
      });
      await tx.conversation.update({
        where: { id: c.id },
        data: { updatedAt: new Date() },
      });
    }
  }
  async confirm(id: string, vendorId: string, reference: string) {
    const invoice = await this.prisma.goodsInvoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });
    if (!invoice || invoice.vendorId !== vendorId)
      throw new NotFoundException('Invoice not found.');
    if (invoice.checkoutReference && invoice.status !== 'PAID')
      throw new BadRequestException(
        'Verify the secure payment through Paystack.',
      );
    if (reference.trim().length < 2)
      throw new BadRequestException('Add the bank transaction reference.');
    await this.settle(
      id,
      reference.trim(),
      vendorId,
      invoice.paymentMethod === 'pay_on_delivery' ? 'pay_on_delivery' : 'bank',
    );
    return this.get(id, { userId: vendorId });
  }
  private async settle(
    id: string,
    reference: string,
    confirmedBy: string | null,
    method: string,
  ) {
    const found = await this.prisma.goodsInvoice.findUniqueOrThrow({
      where: { id },
    });
    await this.transaction(async (tx) => {
      await lockOrder(tx, found.orderId);
      const invoice = await tx.goodsInvoice.findUniqueOrThrow({
        where: { id },
      });
      if (invoice.status === 'PAID') return;
      const latePayment = invoice.status === 'VOID';
      // A receipt records money actually received, even after a cancelled quote. Fulfilment stays rejected.
      await tx.goodsInvoice.update({
        where: { id },
        data: {
          status: 'PAID',
          paymentIssue: latePayment ? 'RECEIVED_AFTER_CANCELLATION' : null,
          paidAt: new Date(),
          receiptNumber: `RCT-${randomUUID().toUpperCase()}`,
          confirmationReference: reference,
          confirmedBy,
          paymentMethod: method,
        },
      });
      await tx.invoiceTransferReport.updateMany({
        where: { invoiceId: id, status: 'PENDING' },
        data: { status: 'ACCEPTED', reviewedAt: new Date() },
      });
      await reconcileInvoicePayments(tx, invoice.orderId);
      await this.event(
        tx,
        invoice,
        'Payment confirmed. Your receipt is available on Whazzonline.',
        confirmedBy,
      );
    });
  }
  async rejectReport(
    id: string,
    vendorId: string,
    reportId: string,
    note: string,
  ) {
    const invoice = await this.prisma.goodsInvoice.findFirst({
      where: { id, vendorId },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    await this.transaction(async (tx) => {
      await lockOrder(tx, invoice.orderId);
      if (
        (await tx.goodsInvoice.findUniqueOrThrow({ where: { id } })).status ===
        'PAID'
      )
        throw new BadRequestException('Payment is already confirmed.');
      if (
        (await tx.goodsInvoice.findUniqueOrThrow({ where: { id } })).status ===
        'VOID'
      )
        throw new BadRequestException(
          'This invoice was cancelled. Record any actual payment separately.',
        );
      const changed = await tx.invoiceTransferReport.updateMany({
        where: { id: reportId, invoiceId: id, status: 'PENDING' },
        data: { status: 'REJECTED', reviewedAt: new Date(), reviewNote: note },
      });
      if (!changed.count)
        throw new BadRequestException(
          'Transfer report not found or already reviewed.',
        );
      const pending = await tx.invoiceTransferReport.count({
        where: { invoiceId: id, status: 'PENDING' },
      });
      await tx.goodsInvoice.update({
        where: { id },
        data: { status: pending ? 'PAYMENT_REPORTED' : 'OPEN' },
      });
      await this.event(
        tx,
        invoice,
        `Transfer not confirmed: ${note}`,
        vendorId,
      );
    });
    return this.get(id, { userId: vendorId });
  }
  async void(id: string, vendorId: string | null, expired = false) {
    const found = await this.prisma.goodsInvoice.findUnique({ where: { id } });
    if (!found || (!expired && found.vendorId !== vendorId))
      throw new NotFoundException('Invoice not found.');
    await this.transaction(async (tx) => {
      await lockOrder(tx, found.orderId);
      const invoice = await tx.goodsInvoice.findUniqueOrThrow({
        where: { id },
      });
      if (invoice.status === 'VOID') return;
      if (invoice.status === 'PAID')
        throw new BadRequestException(
          'Paid invoices need a refund or dispute, not cancellation.',
        );
      const fulfillment = await tx.sellerFulfillment.findUnique({
        where: {
          orderId_vendorId: {
            orderId: invoice.orderId,
            vendorId: invoice.vendorId,
          },
        },
      });
      // Expiry is a quote reservation deadline, not a cancellation of accepted or shipped orders.
      if (
        expired &&
        (invoice.expiresAt > new Date() ||
          invoice.status !== 'OPEN' ||
          fulfillment?.status !== 'pending')
      )
        return;
      if (['out_for_delivery', 'delivered'].includes(fulfillment?.status ?? ''))
        throw new BadRequestException(
          'Dispatched goods require a return or dispute, not cancellation.',
        );
      if (invoice.checkoutReference && !expired)
        throw new BadRequestException(
          'A secure checkout is in progress. Verify it before cancellation.',
        );
      await tx.goodsInvoice.update({ where: { id }, data: { status: 'VOID' } });
      await reconcileInvoicePayments(tx, invoice.orderId);
      await tx.sellerFulfillment.updateMany({
        where: { orderId: invoice.orderId, vendorId: invoice.vendorId },
        data: {
          status: 'rejected',
          rejectionReason: expired ? 'Invoice expired' : 'Invoice cancelled',
        },
      });
      await syncOrder(tx, invoice.orderId);
      const items = await tx.commerceOrderItem.findMany({
        where: { orderId: invoice.orderId, vendorId: invoice.vendorId },
      });
      await releaseOfferUnits(tx, items);
      for (const item of items)
        await tx.product.updateMany({
          where: { id: item.productId },
          data: { quantity: { increment: item.quantity } },
        });
      await this.event(
        tx,
        invoice,
        expired
          ? 'Invoice expired. Reserved stock released.'
          : 'Invoice cancelled. Reserved stock released.',
        vendorId,
      );
    });
    return { cancelled: true };
  }
  async expire() {
    const invoices = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT i."id" FROM "GoodsInvoice" i
      JOIN "SellerFulfillment" f ON f."orderId" = i."orderId" AND f."vendorId" = i."vendorId"
      WHERE i."status" = 'OPEN' AND i."expiresAt" <= NOW() AND f."status" = 'pending'
      ORDER BY i."expiresAt" ASC LIMIT 100
    `;
    for (const invoice of invoices) await this.void(invoice.id, null, true);
  }
  private key() {
    const key = Buffer.from(
      process.env.MERCHANT_PAYMENT_ENCRYPTION_KEY ?? '',
      'base64',
    );
    if (key.length !== 32)
      throw new ServiceUnavailableException(
        'Merchant secure checkout is not configured yet.',
      );
    return key;
  }
  private encrypt(secret: string, aad: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(aad));
    const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      data.toString('base64'),
    ].join('.');
  }
  private decrypt(value: string, aad: string) {
    const [iv, tag, data] = value.split('.'),
      cipher = createDecipheriv(
        'aes-256-gcm',
        this.key(),
        Buffer.from(iv, 'base64'),
      );
    cipher.setAAD(Buffer.from(aad));
    cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      cipher.update(Buffer.from(data, 'base64')),
      cipher.final(),
    ]).toString('utf8');
  }
  private async paystack(secret: string, path: string, body?: object) {
    try {
      const response = await fetch(`https://api.paystack.co/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(12000),
      });
      const result = (await response.json()) as {
        status: boolean;
        data: Record<string, unknown>;
      };
      if (!response.ok || !result.status) throw new Error('provider');
      return result.data;
    } catch {
      throw new ServiceUnavailableException(
        'Merchant Paystack account could not process this request. Please try again.',
      );
    }
  }
  async connectionStatus(vendorId: string) {
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId: vendorId },
      select: {
        id: true,
        bankName: true,
        bankAccountNumber: true,
        bankAccountName: true,
        paymentConnections: {
          where: { enabled: true },
          select: { id: true, mode: true, createdAt: true },
        },
      },
    });
    if (!profile) throw new NotFoundException('Merchant profile not found.');
    return {
      enabled: process.env.MERCHANT_PAYSTACK_CHECKOUT_ENABLED === 'true',
      bank: {
        bankName: profile.bankName,
        accountNumber: profile.bankAccountNumber,
        accountName: profile.bankAccountName,
      },
      connection: profile.paymentConnections[0] ?? null,
      webhookUrl: `${(process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '')}/merchant-payments/webhook/${vendorId}`,
    };
  }
  async connect(vendorId: string, secret: string) {
    if (process.env.MERCHANT_PAYSTACK_CHECKOUT_ENABLED !== 'true')
      throw new BadRequestException(
        'Merchant secure checkout is not available yet. Bank transfer invoices remain available.',
      );
    if (secret === process.env.PAYSTACK_SECRET_KEY)
      throw new BadRequestException(
        'Connect the merchant’s own Paystack account.',
      );
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId: vendorId },
    });
    if (!profile?.setupCompleted || !profile.bankAccountNumber)
      throw new BadRequestException(
        'Complete your merchant bank details first.',
      );
    if (secret.startsWith('sk_test_') && process.env.NODE_ENV === 'production')
      throw new BadRequestException(
        'Use a live merchant Paystack account in production.',
      );
    this.key();
    await this.paystack(secret, 'integration/payment_session_timeout');
    const id = randomUUID();
    await this.transaction(async (tx) => {
      await tx.merchantPaymentConnection.updateMany({
        where: { vendorProfileId: profile.id, enabled: true },
        data: { enabled: false },
      });
      await tx.merchantPaymentConnection.create({
        data: {
          id,
          vendorProfileId: profile.id,
          encryptedKey: this.encrypt(secret, `${profile.id}:${id}`),
          mode: secret.startsWith('sk_live_') ? 'live' : 'test',
        },
      });
    });
    return this.connectionStatus(vendorId);
  }
  async disconnect(vendorId: string) {
    await this.prisma.merchantPaymentConnection.updateMany({
      where: { vendorProfile: { userId: vendorId }, enabled: true },
      data: { enabled: false },
    });
    return this.connectionStatus(vendorId);
  }
  async secureCheckout(id: string, access: InvoiceAccess) {
    if (process.env.MERCHANT_PAYSTACK_CHECKOUT_ENABLED !== 'true')
      throw new BadRequestException(
        'Merchant secure checkout is not available yet.',
      );
    const invoice = await this.prisma.goodsInvoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    this.assertAccess(invoice, access);
    await this.get(id, access);
    if (access.userId === invoice.vendorId)
      throw new ForbiddenException('Only the buyer can pay this invoice.');
    const email = invoice.order.user?.email ?? invoice.order.guestEmail;
    if (!email)
      throw new BadRequestException(
        'Add an email address before using secure checkout.',
      );
    const start = await this.transaction(async (tx) => {
      await lockOrder(tx, invoice.orderId);
      const current = await tx.goodsInvoice.findUniqueOrThrow({
        where: { id },
      });
      if (current.status !== 'OPEN')
        throw new BadRequestException('Invoice is not open for payment.');
      const connection = current.connectionId
        ? await tx.merchantPaymentConnection.findUnique({
            where: { id: current.connectionId },
          })
        : await tx.merchantPaymentConnection.findFirst({
            where: { vendorProfileId: invoice.vendorProfileId, enabled: true },
            orderBy: { createdAt: 'desc' },
          });
      if (!connection)
        throw new BadRequestException(
          'Merchant Paystack account is not connected.',
        );
      const reference = current.checkoutReference ?? `goods_${randomUUID()}`;
      if (!current.checkoutReference)
        await tx.goodsInvoice.update({
          where: { id },
          data: {
            checkoutReference: reference,
            checkoutEmail: email,
            connectionId: connection.id,
            paymentMethod: 'card',
          },
        });
      return { connection, reference, url: current.checkoutUrl };
    });
    if (start.url) return { url: start.url };
    const secret = this.decrypt(
      start.connection.encryptedKey,
      `${start.connection.vendorProfileId}:${start.connection.id}`,
    );
    const data = await this.paystack(secret, 'transaction/initialize', {
      email,
      amount: invoice.total * 100,
      currency: 'NGN',
      reference: start.reference,
      callback_url: `${(process.env.FRONTEND_URL ?? 'https://whazzonline.com').replace(/\/$/, '')}/invoices/${id}?verify=1${access.guestToken ? `#token=${access.guestToken}` : ''}`,
      metadata: { invoiceId: id, purpose: 'merchant_goods' },
    });
    const url =
      typeof data.authorization_url === 'string'
        ? new URL(data.authorization_url)
        : null;
    if (
      !url ||
      url.protocol !== 'https:' ||
      url.hostname !== 'checkout.paystack.com'
    )
      throw new ServiceUnavailableException('Invalid merchant payment URL.');
    await this.prisma.goodsInvoice.update({
      where: { id },
      data: { checkoutUrl: url.href },
    });
    return { url: url.href };
  }
  async verify(id: string, access: InvoiceAccess | null) {
    const invoice = await this.prisma.goodsInvoice.findUnique({
      where: { id },
      include: { ...invoiceInclude, connection: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (access) this.assertAccess(invoice, access);
    if (invoice.status === 'PAID') return { paid: true };
    if (!invoice.checkoutReference || !invoice.connection)
      throw new BadRequestException(
        'No secure payment was started for this invoice.',
      );
    const secret = this.decrypt(
      invoice.connection.encryptedKey,
      `${invoice.connection.vendorProfileId}:${invoice.connection.id}`,
    );
    const data = await this.paystack(
      secret,
      `transaction/verify/${encodeURIComponent(invoice.checkoutReference)}`,
    );
    const email =
        invoice.checkoutEmail ??
        invoice.order.user?.email ??
        invoice.order.guestEmail,
      customer = data.customer as { email?: string } | undefined;
    if (
      data.status !== 'success' ||
      data.reference !== invoice.checkoutReference ||
      data.currency !== 'NGN' ||
      data.amount !== invoice.total * 100 ||
      !email ||
      customer?.email?.toLowerCase() !== email.toLowerCase()
    )
      throw new BadRequestException('Merchant payment has not been verified.');
    await this.settle(id, invoice.checkoutReference, null, 'card');
    return { paid: true };
  }
  async webhook(
    vendorId: string,
    raw: Buffer | undefined,
    signature: string | undefined,
    event: { event?: string; data?: { reference?: string } },
  ) {
    if (!raw || !signature || !/^[a-f0-9]{128}$/i.test(signature))
      throw new UnauthorizedException('Invalid payment signature.');
    const invoice = event.data?.reference
      ? await this.prisma.goodsInvoice.findFirst({
          where: { vendorId, checkoutReference: event.data.reference },
          include: { connection: true },
        })
      : null;
    if (!invoice?.connection) return { received: true };
    const secret = this.decrypt(
        invoice.connection.encryptedKey,
        `${invoice.connection.vendorProfileId}:${invoice.connection.id}`,
      ),
      expected = createHmac('sha512', secret).update(raw).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      throw new UnauthorizedException('Invalid payment signature.');
    if (event.event === 'charge.success') await this.verify(invoice.id, null);
    if (
      event.event === 'refund.processed' ||
      event.event === 'charge.dispute.create'
    )
      await this.referralRewards?.onOrderReversed(invoice.orderId, event.event);
    return { received: true };
  }
  async chatInvoice(
    vendorId: string,
    conversationId: string,
    dto: {
      items: {
        productId: string;
        quantity: number;
        selectedVariants?: Record<string, string>;
      }[];
      deliveryAddress: string;
      deliveryFee: number;
      requestId: string;
    },
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, vendorProfile: { userId: vendorId } },
      include: { buyer: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: dto.items.map((i) => i.productId) },
        vendorProfileId: conversation.vendorProfileId,
        status: 'ACTIVE',
      },
      include: { vendorProfile: { select: { storeName: true } } },
    });
    const lines = dto.items.map((item) => {
      const p = products.find((p) => p.id === item.productId);
      if (!p) throw new BadRequestException('Select your own active products.');
      const now = new Date(),
        price =
          p.promoPrice &&
          p.promoStartsAt &&
          p.promoEndsAt &&
          p.promoStartsAt <= now &&
          p.promoEndsAt > now
            ? p.promoPrice
            : p.unitPrice;
      return {
        productId: p.id,
        vendorId,
        vendorName: p.vendorProfile.storeName,
        name: p.name,
        subtitle: p.category,
        imageUri: variantImage(p, item.selectedVariants),
        sku: p.id,
        unitPrice: price,
        quantity: item.quantity,
        originalPrice: null,
        selectedColor: null,
        selectedSize: null,
        selectedVariants: item.selectedVariants ?? {},
        deliveryAddress: dto.deliveryAddress,
      };
    });
    return this.createCheckout({
      userId: conversation.buyerUserId,
      address: { label: dto.deliveryAddress, latitude: 0, longitude: 0 },
      lines,
      deliveryFee: dto.deliveryFee,
      paymentMethod: 'bank',
      idempotencyKey: `chat:${vendorId}:${dto.requestId}`,
      conversationId,
    });
  }
  async catalog(vendorId: string) {
    return this.prisma.product.findMany({
      where: { vendorProfile: { userId: vendorId }, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        category: true,
        imageUrls: true,
        variants: true,
        unitPrice: true,
        quantity: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async createMerchantOrder(vendorId: string, dto: MerchantOrderInvoiceDto) {
    const recipient = {
      name: dto.buyer.name.trim(),
      email: dto.buyer.email?.trim().toLowerCase(),
      phone: dto.buyer.phone ? normalizePhone(dto.buyer.phone) : undefined,
      userId: dto.buyer.userId,
    };
    if (dto.channels.includes('email') && !recipient.email)
      throw new BadRequestException(
        'Enter an email address for email delivery.',
      );
    if (dto.channels.includes('sms') && !recipient.phone)
      throw new BadRequestException('Enter a phone number for SMS delivery.');
    if (recipient.userId === vendorId)
      throw new BadRequestException('Choose a buyer other than yourself.');
    if (dto.conversationId) {
      const buyer = await this.invoiceBuyer(vendorId, dto.conversationId);
      if (buyer.userId !== recipient.userId)
        throw new BadRequestException('Use the buyer from this conversation.');
    }
    if (
      recipient.userId &&
      !(await this.prisma.user.findFirst({
        where: { id: recipient.userId, isActive: true },
      }))
    )
      throw new BadRequestException(
        'Buyer account not found. Check the account ID or leave it blank for a guest.',
      );
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId: vendorId },
    });
    if (!profile?.setupCompleted)
      throw new BadRequestException('Complete your merchant profile first.');
    const key = `merchant:${vendorId}:${dto.requestId}`;
    let receipt = await this.resume(
      recipient.userId,
      key,
      dto.guestAccessToken,
    );
    if (!receipt) {
      const products = await this.prisma.product.findMany({
        where: {
          id: { in: dto.items.map((i) => i.productId) },
          vendorProfileId: profile.id,
          status: 'ACTIVE',
        },
      });
      const lines = dto.items.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        if (!product)
          throw new BadRequestException('Choose your own active products.');
        const values = item.selectedVariants ?? {};
        if (
          Object.values(values).some(
            (value) => typeof value !== 'string' || value.length > 100,
          )
        )
          throw new BadRequestException('Choose valid product options.');
        return {
          productId: product.id,
          vendorId,
          vendorName: profile.storeName,
          name: product.name,
          subtitle: product.category,
          imageUri: variantImage(product, values),
          sku: product.id,
          unitPrice: product.unitPrice,
          quantity: item.quantity,
          originalPrice: null,
          selectedColor: null,
          selectedSize: null,
          selectedVariants: values,
          deliveryAddress: dto.deliveryAddress,
        };
      });
      const names = recipient.name.split(/\s+/);
      receipt = await this.createCheckout({
        userId: recipient.userId,
        guest: recipient.userId
          ? undefined
          : {
              firstName: names[0],
              lastName: names.slice(1).join(' '),
              email: recipient.email ?? '',
              phone: recipient.phone ?? '',
            },
        guestAccessToken: dto.guestAccessToken,
        idempotencyKey: key,
        address: { label: dto.deliveryAddress, latitude: 0, longitude: 0 },
        paymentMethod: 'bank',
        lines,
        deliveryFee: dto.deliveryFee,
        conversationId: dto.conversationId,
        recipient: JSON.parse(
          JSON.stringify(recipient),
        ) as Prisma.InputJsonValue,
      });
    }
    const invoice = await this.prisma.goodsInvoice.findFirstOrThrow({
      where: { orderId: receipt.id, vendorId },
    });
    // Deliver only the persisted recipient snapshot, even if the client retries with changed fields.
    const saved = invoice.recipient as typeof recipient;
    const base = (
      process.env.FRONTEND_URL ?? 'https://whazzonline.com'
    ).replace(/\/$/, '');
    const link = `${base}/invoices/${invoice.id}${recipient.userId ? '' : `#token=${dto.guestAccessToken}`}`;
    const deliveries = await deliverInvoice(
      this.prisma,
      invoice,
      saved,
      dto.channels,
      link,
    );
    return {
      ...receipt,
      invoice: this.map(
        await this.prisma.goodsInvoice.findUniqueOrThrow({
          where: { id: invoice.id },
          include: invoiceInclude,
        }),
        { userId: vendorId },
      ),
      deliveries,
    };
  }
  async invoiceBuyer(vendorId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, vendorProfile: { userId: vendorId } },
      include: {
        buyer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return {
      userId: conversation.buyer.id,
      name: [conversation.buyer.firstName, conversation.buyer.lastName]
        .filter(Boolean)
        .join(' '),
      email: conversation.buyer.email,
      phone: conversation.buyer.phone,
    };
  }
}
