import type { Prisma } from '../../generated/prisma/client';

export async function existingOrNewThread(tx: Prisma.TransactionClient, buyerUserId: string, vendorProfileId: string, subject = 'Store enquiry', productId?: string, productName?: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${buyerUserId}), hashtext(${vendorProfileId}))::text`;
  const existing = await tx.conversation.findFirst({
    where: { buyerUserId, vendorProfileId, status: { in: ['OPEN', 'PENDING'] } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  });
  return existing ?? tx.conversation.create({ data: { buyerUserId, vendorProfileId, subject, productId, productName } });
}

export async function addOrderToThread(tx: Prisma.TransactionClient, buyerId: string, vendorProfileId: string, merchantUserId: string, orderId: string) {
  const thread = await existingOrNewThread(tx, buyerId, vendorProfileId, `Order ${orderId}`);
  const clientMessageId = `order-update:${orderId}`;
  await tx.chatMessage.upsert({
    where: { conversationId_clientMessageId: { conversationId: thread.id, clientMessageId } },
    create: { conversationId: thread.id, clientMessageId, senderUserId: merchantUserId, kind: 'TEXT', text: `Order #${orderId.slice(0, 8).toUpperCase()} has been added to this conversation.` },
    update: {},
  });
  return tx.conversation.update({ where: { id: thread.id }, data: { latestOrderId: orderId, updatedAt: new Date() } });
}
