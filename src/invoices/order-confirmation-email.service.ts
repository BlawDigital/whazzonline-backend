import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { buildPdf, type PdfLine } from './simple-pdf';

export type ConfirmationOrder = {
  id: string;
  createdAt: Date;
  deliveryAddress: string;
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  guestFirstName: string | null;
  user: { firstName: string | null; email: string | null } | null;
  guestEmail: string | null;
  items: {
    name: string;
    vendorName: string;
    quantity: number;
    unitPrice: number;
    selectedVariants: unknown;
  }[];
  invoices: { number: string }[];
};

const naira = (value: number) => `₦${value.toLocaleString('en-NG')}`;
const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const orderNumber = (id: string) => id.slice(0, 8).toUpperCase();

function variantText(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const parts = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' && v)
    .map(([k, v]) => `${k}: ${String(v)}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/** Pure builder so the content is easy to test without sending anything. */
export function buildOrderConfirmation(
  order: ConfirmationOrder,
  supportUrl: string,
) {
  const number = orderNumber(order.id);
  const name = order.user?.firstName || order.guestFirstName || 'there';
  const paid = order.paymentStatus === 'paid';
  const rows = order.items.map((item) => ({
    label: `${item.name}${variantText(item.selectedVariants)}`,
    vendor: item.vendorName,
    quantity: item.quantity,
    unit: item.unitPrice,
    line: item.unitPrice * item.quantity,
  }));
  const subject = `Your Whazzonline order #${number} is confirmed`;
  const date = order.createdAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const text = [
    `Hi ${name},`,
    '',
    `Thanks for your order. Order #${number}, placed on ${date}.`,
    '',
    'Items:',
    ...rows.map(
      (r) => `- ${r.quantity} x ${r.label} from ${r.vendor}: ${naira(r.line)}`,
    ),
    '',
    `Subtotal: ${naira(order.subtotal)}`,
    `Delivery: ${naira(order.deliveryFee)}`,
    ...(order.serviceFee ? [`Service fee: ${naira(order.serviceFee)}`] : []),
    `Total: ${naira(order.total)}`,
    `Payment: ${paid ? 'Paid' : 'Awaiting payment'}`,
    '',
    `Delivery address: ${order.deliveryAddress}`,
    '',
    `Your invoice is attached as a PDF. Need help? ${supportUrl}`,
  ].join('\n');

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#242424;max-width:600px;margin:auto;padding:16px">
<h2 style="margin:0 0 8px">Order confirmed</h2>
<p>Hi ${escapeHtml(name)}, thanks for your order. <strong>#${number}</strong> was placed on ${date}.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
<thead><tr style="text-align:left;border-bottom:1px solid #ddd"><th style="padding:6px 0">Item</th><th>Qty</th><th style="text-align:right">Amount</th></tr></thead>
<tbody>${rows
    .map(
      (r) =>
        `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:8px 0">${escapeHtml(r.label)}<br><span style="color:#888;font-size:12px">${escapeHtml(r.vendor)}</span></td><td>${r.quantity}</td><td style="text-align:right">${escapeHtml(naira(r.line))}</td></tr>`,
    )
    .join('')}</tbody></table>
<p style="text-align:right;margin:12px 0 0">Subtotal ${escapeHtml(naira(order.subtotal))}<br>Delivery ${escapeHtml(naira(order.deliveryFee))}<br><strong>Total ${escapeHtml(naira(order.total))}</strong><br>${paid ? 'Paid' : 'Awaiting payment'}</p>
<p><strong>Delivery address</strong><br>${escapeHtml(order.deliveryAddress)}</p>
<p>Your invoice is attached as a PDF.</p>
<p>Need help with this order? <a href="${escapeHtml(supportUrl)}">Contact support</a></p>
</body></html>`;

  const lines: PdfLine[] = [
    { text: 'Whazzonline', bold: true, size: 20 },
    {
      text: `Order confirmation and invoice #${number}`,
      bold: true,
      size: 13,
      gap: 6,
    },
    { text: `Date: ${date}`, gap: 4 },
    ...(order.invoices.length
      ? [
          {
            text: `Invoice numbers: ${order.invoices.map((i) => i.number).join(', ')}`,
          },
        ]
      : []),
    {
      text: `Payment: ${paid ? 'Paid' : 'Awaiting payment'} (${order.paymentMethod})`,
    },
    { text: 'Items', bold: true, size: 12, gap: 14 },
    ...rows.flatMap((r): PdfLine[] => [
      {
        text: `${r.quantity} x ${r.label}  @ ${naira(r.unit)}  =  ${naira(r.line)}`,
        gap: 4,
      },
      { text: `Sold by ${r.vendor}`, size: 8 },
    ]),
    { text: `Subtotal: ${naira(order.subtotal)}`, gap: 14 },
    { text: `Delivery: ${naira(order.deliveryFee)}` },
    ...(order.serviceFee
      ? [{ text: `Service fee: ${naira(order.serviceFee)}` }]
      : []),
    { text: `Total: ${naira(order.total)}`, bold: true, size: 12, gap: 4 },
    { text: 'Delivery address', bold: true, size: 12, gap: 14 },
    { text: order.deliveryAddress },
    { text: `Support: ${supportUrl}`, gap: 14 },
  ];
  return { subject, text, html, pdf: buildPdf(lines), number };
}

const MAX_ATTEMPTS = 5;
const SWEEP_INTERVAL_MS = 60_000;

@Injectable()
export class OrderConfirmationEmailService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OrderConfirmationEmailService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
    this.timer = setInterval(() => {
      void this.sweep().catch((error: unknown) =>
        this.logger.error(`Order email sweep failed: ${String(error)}`),
      );
    }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Records the email as owed, then sends it without blocking checkout. */
  async queue(orderId: string) {
    try {
      const order = await this.prisma.commerceOrder.findUnique({
        where: { id: orderId },
        select: { guestEmail: true, user: { select: { email: true } } },
      });
      const destination = order?.user?.email ?? order?.guestEmail ?? null;
      await this.prisma.orderEmailDelivery.upsert({
        where: { orderId },
        create: destination
          ? { orderId, destination }
          : {
              orderId,
              destination: '',
              status: 'SKIPPED',
              lastError: 'No email address.',
            },
        update: {},
      });
      if (destination)
        void this.deliver(orderId).catch((error: unknown) =>
          this.logger.error(`Order email ${orderId} failed: ${String(error)}`),
        );
    } catch (error) {
      this.logger.error(`Could not queue order email: ${String(error)}`);
    }
  }

  async deliver(orderId: string) {
    const claimed = await this.prisma.orderEmailDelivery.updateMany({
      where: {
        orderId,
        status: { in: ['PENDING', 'FAILED'] },
        attempts: { lt: MAX_ATTEMPTS },
      },
      data: {
        status: 'SENDING',
        attemptedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) return false;
    try {
      const order = await this.prisma.commerceOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          items: true,
          invoices: { select: { number: true } },
          user: { select: { firstName: true, email: true } },
        },
      });
      const delivery = await this.prisma.orderEmailDelivery.findUniqueOrThrow({
        where: { orderId },
      });
      if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
        throw new Error('Email is not configured.');
      const supportUrl = `${(process.env.FRONTEND_URL || 'https://whazzonline.com').replace(/\/$/, '')}/support`;
      const mail = buildOrderConfirmation(order, supportUrl);
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(12000),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `order-confirmation-${orderId}`,
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [delivery.destination],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          attachments: [
            {
              filename: `whazzonline-invoice-${mail.number}.pdf`,
              content: mail.pdf.toString('base64'),
            },
          ],
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        id?: string;
      };
      if (!response.ok || !data.id)
        throw new Error(`Provider ${response.status}`);
      await this.prisma.orderEmailDelivery.update({
        where: { orderId },
        data: { status: 'SENT', sentAt: new Date(), lastError: null },
      });
      return true;
    } catch (error) {
      await this.prisma.orderEmailDelivery.update({
        where: { orderId },
        data: { status: 'FAILED', lastError: String(error).slice(0, 300) },
      });
      return false;
    }
  }

  /** Retries every minute so a brief outage still lands inside the 2 minute target. */
  async sweep(now = new Date()) {
    await this.prisma.orderEmailDelivery.updateMany({
      where: {
        status: 'SENDING',
        attemptedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
      },
      data: { status: 'FAILED' },
    });
    const due = await this.prisma.orderEmailDelivery.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        attempts: { lt: MAX_ATTEMPTS },
        createdAt: { gt: new Date(now.getTime() - 24 * 3_600_000) },
        OR: [
          { attemptedAt: null },
          { attemptedAt: { lt: new Date(now.getTime() - 60_000) } },
        ],
      },
      select: { orderId: true },
      take: 25,
      orderBy: { createdAt: 'asc' },
    });
    for (const { orderId } of due) await this.deliver(orderId);
    return due.length;
  }
}
