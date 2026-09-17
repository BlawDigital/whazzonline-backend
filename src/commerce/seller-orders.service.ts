import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { lockOrder, syncOrder } from './fulfillment';

const deliveryCapability = { available: false, reason: 'Courier booking and live tracking are not configured. Arrange delivery directly with the customer.' };
const supportCapability = { available: true, liveChat: false };

type SellerOrderDb = Pick<PrismaService, 'commerceOrder' | 'sellerFulfillment'>;

function mapOrderStatusToFulfillmentStatus(status: string) {
  switch (status) {
    case 'confirmed':
    case 'pending':
      return 'pending';
    case 'processing':
      return 'processing';
    case 'ready':
      return 'ready';
    case 'picked-up':
    case 'in-transit':
    case 'out-for-delivery':
      return 'out_for_delivery';
    case 'delivered':
      return 'delivered';
    case 'rejected':
    case 'cancelled':
      return 'rejected';
    default:
      return 'pending';
  }
}

@Injectable()
export class SellerOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  capabilities() { return { delivery: deliveryCapability, support: supportCapability }; }

  private async ensureFulfillment(userId: string, order: {
    id: string;
    status: string;
    userId: string;
  }, tx: SellerOrderDb = this.prisma) {
    const existing = await tx.sellerFulfillment.findUnique({
      where: { orderId_vendorId: { orderId: order.id, vendorId: userId } },
      include: { history: { orderBy: { createdAt: 'asc' } } },
    });
    if (existing) return existing;

    const status = mapOrderStatusToFulfillmentStatus(order.status);
    const created = await tx.sellerFulfillment.create({
      data: {
        orderId: order.id,
        vendorId: userId,
        status,
        history: {
          create: {
            actorUserId: order.userId,
            status,
          },
        },
      },
      include: { history: { orderBy: { createdAt: 'asc' } } },
    });

    if (status === 'delivered') {
      await tx.commerceOrder.update({
        where: { id: order.id },
        data: { completedAt: new Date() },
      });
    }

    return created;
  }

  async list(userId: string) {
    const rows = await this.prisma.commerceOrder.findMany({
      where: { items: { some: { vendorId: userId } } }, select: { id: true }, orderBy: { createdAt: 'desc' },
    });
    return { orders: await Promise.all(rows.map((row) => this.detail(userId, row.id))) };
  }

  async detail(userId: string, id: string) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id, items: { some: { vendorId: userId } } },
      include: {
        items: { where: { vendorId: userId } },
        user: { select: { id: true, firstName: true, lastName: true } },
        fulfillments: { where: { vendorId: userId }, include: { history: { orderBy: { createdAt: 'asc' } } } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    const fulfillment = order.fulfillments[0] ?? await this.ensureFulfillment(userId, { id: order.id, status: order.status, userId: order.userId }, this.prisma);
    const issues = await this.prisma.orderIssue.findMany({ where: { orderId: id, itemId: { in: order.items.map((item) => item.id) } }, orderBy: { createdAt: 'desc' } });
    const subtotal = order.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    return {
      id, createdAt: order.createdAt.toISOString(), status: fulfillment.status,
      rejectionReason: fulfillment.rejectionReason,
      customer: { id: order.user.id, name: [order.user.firstName, order.user.lastName].filter(Boolean).join(' ') || 'Buyer' },
      deliveryAddress: order.deliveryAddress, items: order.items, subtotal, total: subtotal,
      paymentMethod: order.paymentMethod, paymentStatus: 'unverified',
      history: fulfillment.history, issues, ...this.capabilities(),
    };
  }

  async transition(userId: string, id: string, status: string, reason?: string) {
    if (status === 'rejected' && (!reason?.trim() || reason.trim().length < 3)) throw new BadRequestException('Give a rejection reason.');
    await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const order = await tx.commerceOrder.findFirst({ where: { id, items: { some: { vendorId: userId } } }, include: { items: { where: { vendorId: userId } } } });
      if (!order) throw new NotFoundException('Order not found.');
      const current = await this.ensureFulfillment(userId, { id: order.id, status: order.status, userId: order.userId }, tx);
      if (current.status === status) {
        if (status === 'rejected' && current.rejectionReason !== reason?.trim()) throw new ConflictException('This order was already rejected with another reason.');
        return;
      }
      const allowed: Record<string, string[]> = { pending: ['processing', 'rejected'], processing: ['ready'], ready: ['out_for_delivery'], out_for_delivery: ['delivered'] };
      if (!allowed[current.status]?.includes(status)) throw new ConflictException(`Cannot change ${current.status} to ${status}.`);
      if (status === 'processing') {
        const quantities = new Map<string, number>();
        for (const item of order.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
        // Stable order avoids deadlocks when two orders contain the same products.
        for (const [productId, quantity] of [...quantities].sort(([a], [b]) => a.localeCompare(b))) {
          const reserved = await tx.product.updateMany({ where: { id: productId, vendorProfile: { userId }, status: 'ACTIVE', quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } });
          if (reserved.count !== 1) throw new ConflictException('Insufficient stock to accept this order.');
        }
      }
      const changed = await tx.sellerFulfillment.updateMany({ where: { id: current.id, status: current.status }, data: { status, rejectionReason: status === 'rejected' ? reason!.trim() : null } });
      if (changed.count !== 1) throw new ConflictException('The order changed. Refresh and try again.');
      await tx.sellerFulfillmentEvent.create({ data: { fulfillmentId: current.id, actorUserId: userId, status, reason: status === 'rejected' ? reason!.trim() : null } });
      await syncOrder(tx, id);
    });
    return this.detail(userId, id);
  }

  async delivery(userId: string, id: string) {
    const order = await this.detail(userId, id);
    return { ...deliveryCapability, status: order.status, history: order.history };
  }

  async requestDelivery(userId: string, id: string) {
    await this.detail(userId, id);
    throw new ServiceUnavailableException(deliveryCapability.reason);
  }
}
