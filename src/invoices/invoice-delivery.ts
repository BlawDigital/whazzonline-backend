import type { PrismaService } from 'prisma/prisma.service';

/** Delivery state is durable so retries of order creation never send a second invoice. */
export async function deliverInvoice(
  prisma: PrismaService,
  invoice: { id: string; number: string; total: number },
  recipient: { name: string; email?: string; phone?: string },
  channels: ('sms' | 'email')[],
  link: string,
) {
  for (const channel of [...new Set(channels)]) {
    const destination = (
      channel === 'email' ? recipient.email : recipient.phone
    )!;
    const row = await prisma.invoiceDelivery.upsert({
      where: { invoiceId_channel: { invoiceId: invoice.id, channel } },
      create: { invoiceId: invoice.id, channel, destination },
      update: {},
    });
    const claimed = await prisma.invoiceDelivery.updateMany({
      where: { id: row.id, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'SENDING', attemptedAt: new Date() },
    });
    if (!claimed.count) continue;
    const text = `Whazzonline invoice ${invoice.number} for ${recipient.name}: NGN ${invoice.total.toLocaleString('en-NG')}. Review and pay: ${link}`;
    try {
      let response: Response;
      if (channel === 'email') {
        if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
          throw new Error('configuration');
        response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          signal: AbortSignal.timeout(12000),
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `invoice-${invoice.id}-email`,
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM,
            to: [destination],
            subject: `Whazzonline invoice ${invoice.number}`,
            text,
          }),
        });
      } else {
        if (
          !process.env.TERMII_API_KEY ||
          !process.env.TERMII_BASE_URL ||
          !process.env.TERMII_SENDER_ID
        )
          throw new Error('configuration');
        response = await fetch(
          `${process.env.TERMII_BASE_URL.replace(/\/+$/, '')}/api/sms/send`,
          {
            method: 'POST',
            signal: AbortSignal.timeout(12000),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: process.env.TERMII_API_KEY,
              to: destination.replace(/^\+/, ''),
              from: process.env.TERMII_SENDER_ID,
              sms: text,
              type: 'plain',
              channel: 'generic',
            }),
          },
        );
      }
      const data = (await response.json().catch(() => ({}))) as {
        id?: string;
        message_id?: string;
      };
      const accepted =
        response.ok && (channel === 'email' ? !!data.id : !!data.message_id);
      await prisma.invoiceDelivery.update({
        where: { id: row.id },
        data: {
          status: accepted ? 'SENT' : 'FAILED',
          sentAt: accepted ? new Date() : null,
        },
      });
    } catch (error) {
      // A transport timeout may happen after provider acceptance; do not blindly duplicate SMS.
      const status =
        error instanceof Error && error.message === 'configuration'
          ? 'FAILED'
          : 'UNKNOWN';
      await prisma.invoiceDelivery.update({
        where: { id: row.id },
        data: { status },
      });
    }
  }
  return prisma.invoiceDelivery.findMany({
    where: { invoiceId: invoice.id },
    select: { channel: true, destination: true, status: true, sentAt: true },
  });
}
