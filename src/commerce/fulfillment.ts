import type { Prisma } from '../../generated/prisma/client';
import { normalizeOrderStatus } from './order-status';

export function aggregateStatus(statuses: string[]) {
  const active = statuses
    .map(normalizeOrderStatus)
    .filter((status) => status !== 'rejected');
  if (!active.length) return 'rejected';
  if (active.every((status) => status === 'delivered')) return 'delivered';
  if (active.some((status) => status === 'pending')) return 'confirmed';
  if (active.some((status) => status === 'processing')) return 'processing';
  if (active.some((status) => status === 'ready')) return 'ready';
  return 'out_for_delivery';
}

export async function lockOrder(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "CommerceOrder" WHERE "id" = ${orderId} FOR UPDATE`;
}

export async function syncOrder(tx: Prisma.TransactionClient, orderId: string) {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT "status"
    FROM "SellerFulfillment"
    WHERE "orderId" = ${orderId}
  `;
  const status = aggregateStatus(rows.map((row) => row.status));
  await tx.commerceOrder.update({
    where: { id: orderId },
    data: {
      status,
      completedAt: status === 'delivered' ? new Date() : null,
    },
  });
}

/** Direct goods receipts reconcile independently across the merchants in one order. */
export async function reconcileInvoicePayments(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const active = await tx.goodsInvoice.findMany({
    where: { orderId, status: { not: 'VOID' } },
    select: { status: true, total: true, subtotal: true, deliveryFee: true },
  });
  await tx.commerceOrder.update({
    where: { id: orderId },
    data: {
      paymentStatus: !active.length
        ? 'cancelled'
        : active.every((i) => i.status === 'PAID')
          ? 'paid'
          : active.some((i) => i.status === 'PAID')
            ? 'partial'
            : 'pending',
      total: active.reduce((sum, i) => sum + i.total, 0),
      subtotal: active.reduce((sum, i) => sum + i.subtotal, 0),
      deliveryFee: active.reduce((sum, i) => sum + i.deliveryFee, 0),
    },
  });
}
