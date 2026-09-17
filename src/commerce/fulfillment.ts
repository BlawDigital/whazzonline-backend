import type { Prisma } from '../../generated/prisma/client';

export function aggregateStatus(statuses: string[]) {
  const active = statuses.filter((status) => status !== 'rejected');
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
  await tx.commerceOrder.update({ where: { id: orderId }, data: {
    status, completedAt: status === 'delivered' ? new Date() : null,
  } });
}
