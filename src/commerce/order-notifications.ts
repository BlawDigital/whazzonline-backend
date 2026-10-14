export interface OrderNotice {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  type: string;
  orderId?: string;
  ticketId?: string;
  merchantId?: string;
}
interface NotificationOrder {
  id: string;
  userId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  fulfillments: {
    vendorId: string;
    status: string;
    history: {
      id: string;
      status: string;
      reason: string | null;
      actorUserId: string | null;
      createdAt: Date;
    }[];
    deliveryRequest: {
      id: string;
      serviceLevel: string;
      createdAt: Date;
    } | null;
  }[];
}
export const orderNotificationSelect = {
  id: true,
  userId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  fulfillments: {
    include: {
      history: { orderBy: { createdAt: 'asc' as const } },
      deliveryRequest: true,
    },
  },
} as const;

export function orderNotices(
  order: NotificationOrder,
  userId: string,
): OrderNotice[] {
  const buyer = order.userId === userId;
  const displayId = order.id.slice(0, 8).toUpperCase();
  const statuses: Record<string, string> = {
    pending: 'pending',
    processing: 'accepted',
    ready: 'ready for pickup',
    out_for_delivery: 'out for delivery',
    delivered: 'delivered',
    rejected: 'rejected',
  };
  const fulfillments = (order.fulfillments || []).filter(
    (f) => buyer || f.vendorId === userId,
  );
  if (!fulfillments.length)
    return [
      {
        id: `merchant-order:${order.id}:${order.updatedAt.getTime()}`,
        orderId: order.id,
        title: buyer ? 'Your order update' : 'New order',
        type: 'order',
        read: false,
        body: `Order #${displayId} is ${order.status.replace(/_/g, ' ')}.`,
        createdAt: order.updatedAt.toISOString(),
      },
    ];
  return fulfillments.flatMap((fulfillment) => [
    ...fulfillment.history.map((event) => ({
      id: event.id,
      orderId: order.id,
      type: 'order',
      title: event.reason?.startsWith('Buyer reported')
        ? 'Transfer awaiting confirmation'
        : event.reason?.startsWith('Payment confirmed')
          ? 'Receipt available'
          : event.reason?.startsWith('Transfer not confirmed')
            ? 'Transfer not confirmed'
            : event.reason?.startsWith('Invoice ')
              ? 'Merchant invoice'
              : normalizeOrderStatus(event.status) === 'pending'
                ? buyer
                  ? 'Order placed'
                  : 'New order'
                : `Order ${statuses[normalizeOrderStatus(event.status)] || 'update'}`,
      body:
        event.reason &&
        /^(Buyer reported|Payment confirmed|Transfer not confirmed|Invoice )/.test(
          event.reason,
        )
          ? event.reason
          : normalizeOrderStatus(event.status) === 'pending' && !buyer
            ? `Order #${displayId} is waiting for your review.`
            : `Order #${displayId} is ${statuses[normalizeOrderStatus(event.status)] || event.status.replace(/_/g, ' ')}.${event.reason ? ` Reason: ${event.reason}` : ''}`,
      createdAt: event.createdAt.toISOString(),
      read: event.actorUserId === userId,
    })),
    ...(fulfillment.deliveryRequest
      ? [
          {
            id: `delivery:${fulfillment.deliveryRequest.id}`,
            orderId: order.id,
            type: 'order',
            title: 'Delivery requested',
            body: `${fulfillment.deliveryRequest.serviceLevel === 'priority' ? 'Priority Express' : 'Standard Delivery'} requested for order #${displayId}.`,
            createdAt: fulfillment.deliveryRequest.createdAt.toISOString(),
            read: !buyer,
          },
        ]
      : []),
  ]);
}

export const supportReplySelect = {
  id: true,
  text: true,
  createdAt: true,
  ticketId: true,
  ticket: { select: { subject: true, orderId: true } },
} as const;
export function supportReplyNotice(message: {
  id: string;
  ticketId: string;
  text: string | null;
  createdAt: Date;
  ticket: { subject: string; orderId: string | null };
}): OrderNotice {
  return {
    id: `support:${message.id}`,
    type: 'order',
    ticketId: message.ticketId,
    ...(message.ticket.orderId ? { orderId: message.ticket.orderId } : {}),
    title: 'Merchant Support reply',
    body: `${message.ticket.subject}: ${message.text || 'New attachment'}`,
    createdAt: message.createdAt.toISOString(),
    read: false,
  };
}
import { normalizeOrderStatus } from './order-status';
