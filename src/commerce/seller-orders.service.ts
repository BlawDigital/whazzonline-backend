import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { DeliveryProvider, type DeliveryLevel } from './delivery.provider';
import { lockOrder, syncOrder } from './fulfillment';

const deliveryCapability = { available: true, mode: 'mock', provider: 'mock' };
const supportCapability = { available: true, liveChat: true };

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveryProvider: DeliveryProvider,
  ) {}

  capabilities() {
    return { delivery: deliveryCapability, support: supportCapability };
  }

  private async ensureFulfillment(
    userId: string,
    order: {
      id: string;
      status: string;
      userId: string;
    },
    tx: SellerOrderDb = this.prisma,
  ) {
    const existing = await tx.sellerFulfillment.findUnique({
      where: { orderId_vendorId: { orderId: order.id, vendorId: userId } },
      include: {
        history: { orderBy: { createdAt: 'asc' } },
        deliveryRequest: true,
      },
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
      include: {
        history: { orderBy: { createdAt: 'asc' } },
        deliveryRequest: true,
      },
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
      where: { items: { some: { vendorId: userId } } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      orders: await Promise.all(rows.map((row) => this.detail(userId, row.id))),
    };
  }

  async notifications(userId: string) {
    const { orders } = await this.list(userId);
    const notifications = orders
      .flatMap((order) => {
        const history = Array.isArray(order.history) ? order.history : [];
        if (!history.length) {
          return [
            {
              body: `Order #${order.displayId} is waiting for your review.`,
              createdAt: order.createdAt,
              id: `order:${order.id}`,
              orderId: order.id,
              read: false,
              title: 'New order',
              type: 'order',
            },
          ];
        }
        return history.map((event) => ({
          body:
            event.status === 'pending'
              ? `Order #${order.displayId} is waiting for your review.`
              : `Order #${order.displayId} is now ${event.status.replace(/_/g, ' ')}.`,
          createdAt: event.createdAt.toISOString(),
          id: event.id,
          orderId: order.id,
          read: event.actorUserId === userId,
          title: event.status === 'pending' ? 'New order' : 'Order update',
          type: 'order',
        }));
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return {
      notifications: notifications.slice(0, 50),
      unreadCount: notifications.filter((item) => !item.read).length,
    };
  }

  async detail(userId: string, id: string) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id, items: { some: { vendorId: userId } } },
      include: {
        items: { where: { vendorId: userId } },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            avatarUrl: true,
          },
        },
        fulfillments: {
          where: { vendorId: userId },
          include: {
            history: { orderBy: { createdAt: 'asc' } },
            deliveryRequest: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    const fulfillment =
      order.fulfillments[0] ??
      (await this.ensureFulfillment(
        userId,
        { id: order.id, status: order.status, userId: order.userId },
        this.prisma,
      ));
    const issues = await this.prisma.orderIssue.findMany({
      where: {
        orderId: id,
        itemId: { in: order.items.map((item) => item.id) },
      },
      orderBy: { createdAt: 'desc' },
    });
    const subtotal = order.items.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    return {
      id,
      createdAt: order.createdAt.toISOString(),
      status: fulfillment.status,
      rejectionReason: fulfillment.rejectionReason,
      displayId: order.id.slice(0, 8).toUpperCase(),
      customer: {
        id: order.user.id,
        name:
          [order.user.firstName, order.user.lastName]
            .filter(Boolean)
            .join(' ') || 'Buyer',
        phone: order.user.phone,
        avatarUrl: order.user.avatarUrl,
      },
      deliveryAddress: order.deliveryAddress,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.name,
        imageUrl: item.imageUri,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        variant:
          [
            item.selectedColor,
            item.selectedSize,
            ...Object.values(item.selectedVariants as Record<string, string>),
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
      })),
      subtotal,
      total: subtotal,
      paymentMethod: order.paymentMethod,
      paymentStatus: 'unverified',
      latitude: order.latitude,
      longitude: order.longitude,
      history: fulfillment.history,
      issues,
      deliveryRequest: fulfillment.deliveryRequest,
      ...this.capabilities(),
    };
  }

  async transition(
    userId: string,
    id: string,
    status: string,
    reason?: string,
  ) {
    if (status === 'rejected' && (!reason?.trim() || reason.trim().length < 3))
      throw new BadRequestException('Give a rejection reason.');
    await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const order = await tx.commerceOrder.findFirst({
        where: { id, items: { some: { vendorId: userId } } },
        include: { items: { where: { vendorId: userId } } },
      });
      if (!order) throw new NotFoundException('Order not found.');
      const current = await this.ensureFulfillment(
        userId,
        { id: order.id, status: order.status, userId: order.userId },
        tx,
      );
      if (current.status === status) {
        if (status === 'rejected' && current.rejectionReason !== reason?.trim())
          throw new ConflictException(
            'This order was already rejected with another reason.',
          );
        return;
      }
      const allowed: Record<string, string[]> = {
        pending: ['processing', 'rejected'],
        processing: ['ready'],
        ready: ['out_for_delivery'],
        out_for_delivery: ['delivered'],
      };
      if (!allowed[current.status]?.includes(status))
        throw new ConflictException(
          `Cannot change ${current.status} to ${status}.`,
        );
      if (status === 'processing') {
        const quantities = new Map<string, number>();
        for (const item of order.items)
          quantities.set(
            item.productId,
            (quantities.get(item.productId) ?? 0) + item.quantity,
          );
        // Stable order avoids deadlocks when two orders contain the same products.
        for (const [productId, quantity] of [...quantities].sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          const reserved = await tx.product.updateMany({
            where: {
              id: productId,
              vendorProfile: { userId },
              status: 'ACTIVE',
              quantity: { gte: quantity },
            },
            data: { quantity: { decrement: quantity } },
          });
          if (reserved.count !== 1)
            throw new ConflictException(
              'Insufficient stock to accept this order.',
            );
        }
      }
      const changed = await tx.sellerFulfillment.updateMany({
        where: { id: current.id, status: current.status },
        data: {
          status,
          rejectionReason: status === 'rejected' ? reason!.trim() : null,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'The order changed. Refresh and try again.',
        );
      await tx.sellerFulfillmentEvent.create({
        data: {
          fulfillmentId: current.id,
          actorUserId: userId,
          status,
          reason: status === 'rejected' ? reason!.trim() : null,
        },
      });
      if (status === 'out_for_delivery' || status === 'delivered') {
        await tx.deliveryRequest.updateMany({
          where: { fulfillmentId: current.id },
          data: {
            status: status === 'delivered' ? 'delivered' : 'out_for_delivery',
          },
        });
      }
      await syncOrder(tx, id);
    });
    return this.detail(userId, id);
  }

  async delivery(userId: string, id: string) {
    const order = await this.detail(userId, id);
    const quotes = this.deliveryProvider.quotes().map((quote) => ({
      id: quote.serviceLevel,
      name:
        quote.serviceLevel === 'priority'
          ? 'Priority Express'
          : 'Standard Delivery',
      description:
        quote.mode === 'mock' ? 'Simulated courier for testing' : undefined,
      etaLabel: `ETA: ${quote.etaMinutes} mins`,
      price: quote.fee,
      currency: 'NGN',
    }));
    const request = order.deliveryRequest;
    return {
      ...deliveryCapability,
      status: request?.status ?? order.status,
      statusLabel: request
        ? request.status.replace(/_/g, ' ')
        : 'Delivery not requested',
      etaLabel: request ? `Arriving in about ${request.etaMinutes} mins` : null,
      coordinates: request
        ? { latitude: order.latitude, longitude: order.longitude }
        : null,
      updatedAt: request?.updatedAt?.toISOString?.() ?? null,
      timeline: order.history,
      request,
      quotes,
    };
  }

  async requestDelivery(
    userId: string,
    id: string,
    serviceLevel: DeliveryLevel,
  ) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id, items: { some: { vendorId: userId } } },
      include: {
        fulfillments: {
          where: { vendorId: userId },
          include: { deliveryRequest: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    const fulfillment =
      order.fulfillments[0] ?? (await this.ensureFulfillment(userId, order));
    if (
      !['processing', 'ready', 'out_for_delivery'].includes(fulfillment.status)
    ) {
      throw new ConflictException(
        'Accept and prepare the order before requesting delivery.',
      );
    }
    if (fulfillment.deliveryRequest) {
      if (fulfillment.deliveryRequest.serviceLevel !== serviceLevel) {
        throw new ConflictException(
          'A delivery request already exists for this order.',
        );
      }
      return this.delivery(userId, id);
    }
    const booking = this.deliveryProvider.book(fulfillment.id, serviceLevel);
    await this.prisma.deliveryRequest.create({
      data: {
        fulfillmentId: fulfillment.id,
        provider: booking.provider,
        serviceLevel: booking.serviceLevel,
        status: booking.status,
        fee: booking.fee,
        etaMinutes: booking.etaMinutes,
        trackingCode: booking.trackingCode,
        rider: booking.rider,
      },
    });
    return this.delivery(userId, id);
  }

  async createDispute(
    userId: string,
    orderId: string,
    reason: string,
    description: string,
    evidenceUrls: string[],
  ) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id: orderId, items: { some: { vendorId: userId } } },
      include: { items: { where: { vendorId: userId }, take: 1 } },
    });
    if (!order || !order.items[0])
      throw new NotFoundException('Order not found.');
    const issue = await this.prisma.orderIssue.create({
      data: {
        userId,
        orderId,
        itemId: order.items[0].id,
        type: reason.trim(),
        description: description.trim(),
        replies: evidenceUrls.length
          ? {
              create: {
                authorUserId: userId,
                text: description.trim(),
                evidenceUrls,
              },
            }
          : undefined,
      },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    });
    return issue;
  }

  async customerConversation(userId: string, orderId: string) {
    const [order, vendor] = await Promise.all([
      this.prisma.commerceOrder.findFirst({
        where: { id: orderId, items: { some: { vendorId: userId } } },
        select: { userId: true },
      }),
      this.prisma.vendorProfile.findUnique({
        where: { userId },
        select: { id: true },
      }),
    ]);
    if (!order || !vendor)
      throw new NotFoundException('Order or seller profile not found.');
    const clientThreadId = `order:${orderId}:${vendor.id}`;
    const conversation = await this.prisma.conversation.upsert({
      where: { clientThreadId },
      create: {
        buyerUserId: order.userId,
        clientThreadId,
        subject: `Order ${orderId}`,
        vendorProfileId: vendor.id,
      },
      update: {},
      select: { id: true },
    });
    return conversation;
  }
}
