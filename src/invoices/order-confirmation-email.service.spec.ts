import {
  buildOrderConfirmation,
  OrderConfirmationEmailService,
  type ConfirmationOrder,
} from './order-confirmation-email.service';
import { buildPdf } from './simple-pdf';

const order: ConfirmationOrder = {
  id: 'abcdef12-3456-7890-abcd-ef1234567890',
  createdAt: new Date('2026-03-05T10:00:00Z'),
  deliveryAddress: '12 Allen Avenue, Ikeja <Lagos>',
  subtotal: 12000,
  deliveryFee: 1500,
  serviceFee: 0,
  total: 13500,
  paymentMethod: 'wallet',
  paymentStatus: 'paid',
  guestFirstName: null,
  guestEmail: null,
  user: { firstName: 'Ada', email: 'ada@example.com' },
  items: [
    {
      name: 'Leather bag (large)',
      vendorName: 'Bags & Co',
      quantity: 2,
      unitPrice: 6000,
      selectedVariants: { Color: 'Black' },
    },
  ],
  invoices: [{ number: 'INV-100' }],
};

describe('buildOrderConfirmation', () => {
  const mail = buildOrderConfirmation(order, 'https://whazzonline.com/support');
  it('includes the item breakdown, delivery address and support link', () => {
    expect(mail.subject).toContain('#ABCDEF12');
    for (const part of [
      '2 x Leather bag (large) (Color: Black) from Bags & Co',
      '₦12,000',
      '₦13,500',
      '12 Allen Avenue, Ikeja <Lagos>',
      'https://whazzonline.com/support',
    ])
      expect(mail.text).toContain(part);
    expect(mail.html).toContain('href="https://whazzonline.com/support"');
    expect(mail.html).toContain('Bags &amp; Co');
  });
  it('escapes user supplied text in the HTML body', () => {
    expect(mail.html).toContain('Ikeja &lt;Lagos&gt;');
    expect(mail.html).not.toContain('<Lagos>');
  });
  it('produces a well formed PDF invoice attachment', () => {
    const pdf = mail.pdf.toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('NGN 13,500');
    expect(pdf).toContain('12 Allen Avenue');
    const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(start, start + 4)).toBe('xref');
  });
});

describe('buildPdf', () => {
  it('paginates long documents and escapes parentheses and backslashes', () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({
      text: `Line ${i} (with) back\\slash`,
    }));
    const pdf = buildPdf(lines).toString('latin1');
    expect(/\/Count (\d+)/.exec(pdf)![1]).not.toBe('1');
    expect(pdf).toContain('Line 5 \\(with\\) back\\\\slash');
  });
  it('replaces characters outside Latin-1 so the file stays valid', () => {
    expect(buildPdf([{ text: 'Price ₦500 ✓' }]).toString('latin1')).toContain(
      'Price NGN 500 ?',
    );
  });
});

describe('OrderConfirmationEmailService', () => {
  function build() {
    const rows = new Map<string, Record<string, unknown>>();
    const prisma = {
      commerceOrder: {
        findUnique: jest.fn().mockResolvedValue({
          guestEmail: null,
          user: { email: 'ada@example.com' },
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(order),
      },
      orderEmailDelivery: {
        upsert: jest.fn(
          async ({
            where,
            create,
          }: {
            where: { orderId: string };
            create: Record<string, unknown>;
          }) => {
            if (!rows.has(where.orderId))
              rows.set(where.orderId, {
                status: 'PENDING',
                attempts: 0,
                ...create,
              });
            return rows.get(where.orderId);
          },
        ),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { orderId: string; status: { in: string[] } };
            data: Record<string, unknown>;
          }) => {
            const row = rows.get(where.orderId);
            if (!row || !where.status.in.includes(row.status as string))
              return { count: 0 };
            Object.assign(row, data, {
              attempts: (row.attempts as number) + 1,
            });
            return { count: 1 };
          },
        ),
        findUniqueOrThrow: jest.fn(
          async ({ where }: { where: { orderId: string } }) =>
            rows.get(where.orderId),
        ),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { orderId: string };
            data: Record<string, unknown>;
          }) => {
            Object.assign(rows.get(where.orderId)!, data);
          },
        ),
      },
    };
    return {
      rows,
      prisma,
      service: new OrderConfirmationEmailService(prisma as never),
    };
  }
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it('sends one email with the PDF attached and marks it SENT', async () => {
    process.env.RESEND_API_KEY = 'key';
    process.env.EMAIL_FROM = 'Whazzonline <hi@example.com>';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'mail-1' }), { status: 200 }),
      );
    const { service, rows } = build();
    await service.queue(order.id);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(body.to).toEqual(['ada@example.com']);
    expect(body.attachments[0].filename).toMatch(/\.pdf$/);
    expect(
      Buffer.from(body.attachments[0].content, 'base64').toString('latin1'),
    ).toMatch(/^%PDF/);
    expect(rows.get(order.id)!.status).toBe('SENT');
    // A second trigger cannot send again.
    await expect(service.deliver(order.id)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('marks a failed send FAILED so the sweep can retry it', async () => {
    process.env.RESEND_API_KEY = 'key';
    process.env.EMAIL_FROM = 'a@b.co';
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 500 }));
    const { service, rows } = build();
    await service.queue(order.id);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(rows.get(order.id)!.status).toBe('FAILED');
  });

  it('skips orders that have no email address', async () => {
    const { service, prisma, rows } = build();
    prisma.commerceOrder.findUnique.mockResolvedValue({
      guestEmail: null,
      user: { email: null },
    });
    const fetchMock = jest.spyOn(global, 'fetch');
    await service.queue('no-email-order');
    expect(rows.get('no-email-order')!.status).toBe('SKIPPED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
