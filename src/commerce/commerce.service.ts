import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from 'prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { ReportOrderIssueDto } from './dto/report-order-issue.dto';

const SERVICE_FEE = 6;
const DELIVERY_FEE = 13;

function sameVariants(left: unknown, right: unknown) {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

@Injectable()
export class CommerceService {
  constructor(private readonly prisma: PrismaService) {}

  private mapItem(item: {
    id: string;
    productId: string;
    vendorId: string;
    vendorName: string;
    name: string;
    subtitle: string;
    imageUri: string;
    sku: string;
    unitPrice: number;
    originalPrice: number | null;
    quantity: number;
    selectedColor: string | null;
    selectedSize: string | null;
    selectedVariants: unknown;
    deliveryAddress: string;
  }) {
    return {
      ...item,
      originalPrice: item.originalPrice ?? undefined,
      selectedColor: item.selectedColor ?? undefined,
      selectedSize: item.selectedSize ?? undefined,
      selectedVariants: (item.selectedVariants ?? {}) as Record<string, string>,
    };
  }

  private mapOrder(order: {
    id: string;
    createdAt: Date;
    completedAt: Date | null;
    deliveryAddress: string;
    status: string;
    subtotal: number;
    serviceFee: number;
    deliveryFee: number;
    total: number;
    items: Parameters<CommerceService['mapItem']>[0][];
    issues: { id: string }[];
    returnRequests: { id: string }[];
  }) {
    return {
      completedAt: order.completedAt?.toISOString(),
      createdAt: order.createdAt.toISOString(),
      deliveryAddress: order.deliveryAddress,
      id: order.id,
      issueStatus: order.issues.length ? ('reported' as const) : undefined,
      items: order.items.map((item) => this.mapItem(item)),
      paymentSummary: {
        deliveryFee: order.deliveryFee,
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        serviceFee: order.serviceFee,
        subtotal: order.subtotal,
      },
      returnStatus: order.returnRequests.length
        ? ('requested' as const)
        : undefined,
      status: order.status,
      total: order.total,
    };
  }

  async snapshot(userId: string) {
    const [items, orders] = await Promise.all([
      this.prisma.commerceCartItem.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.commerceOrder.findMany({
        where: { userId },
        include: {
          items: true,
          issues: { select: { id: true } },
          returnRequests: { select: { id: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const mapped = orders.map((order) => this.mapOrder(order));
    return {
      items: items.map((item) => this.mapItem(item)),
      ongoingOrders: mapped.filter((order) => order.status !== 'delivered'),
      completedOrders: mapped.filter((order) => order.status === 'delivered'),
    };
  }

  async addItem(userId: string, dto: AddCartItemDto) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        status: 'ACTIVE',
        vendorProfile: { setupCompleted: true },
      },
      include: { vendorProfile: { select: { storeName: true, userId: true } } },
    });
    if (!product)
      throw new NotFoundException('This product is no longer available.');
    if (dto.quantity > product.quantity) {
      throw new BadRequestException('The requested quantity is not available.');
    }

    const currentItems = await this.prisma.commerceCartItem.findMany({
      where: { userId, productId: product.id },
    });
    const variants = dto.selectedVariants ?? {};
    const existing = currentItems.find(
      (item) =>
        item.selectedColor === (dto.selectedColor ?? null) &&
        item.selectedSize === (dto.selectedSize ?? null) &&
        sameVariants(item.selectedVariants, variants),
    );
    const nextQuantity = (existing?.quantity ?? 0) + dto.quantity;
    if (nextQuantity > product.quantity) {
      throw new BadRequestException('The requested quantity is not available.');
    }

    const unitPrice = product.promoPrice ?? product.unitPrice;
    const data = {
      deliveryAddress: dto.deliveryAddress,
      imageUri: product.imageUrls[0] ?? dto.imageUri,
      name: product.name,
      originalPrice: product.promoPrice ? product.unitPrice : null,
      productId: product.id,
      quantity: nextQuantity,
      selectedColor: dto.selectedColor,
      selectedSize: dto.selectedSize,
      selectedVariants: variants,
      sku: product.id,
      subtitle: dto.subtitle,
      unitPrice,
      userId,
      vendorId: product.vendorProfile.userId,
      vendorName: product.vendorProfile.storeName,
    };
    const item = existing
      ? await this.prisma.commerceCartItem.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.commerceCartItem.create({ data });
    return this.mapItem(item);
  }

  async updateQuantity(userId: string, id: string, quantity: number) {
    const item = await this.prisma.commerceCartItem.findFirst({
      where: { id, userId },
      include: { product: { select: { quantity: true } } },
    });
    if (!item) throw new NotFoundException('Cart item not found.');
    if (quantity > item.product.quantity) {
      throw new BadRequestException('The requested quantity is not available.');
    }
    await this.prisma.commerceCartItem.update({
      where: { id },
      data: { quantity },
    });
    return { id, quantity };
  }

  async removeItem(userId: string, id: string) {
    const result = await this.prisma.commerceCartItem.deleteMany({
      where: { id, userId },
    });
    if (!result.count) throw new NotFoundException('Cart item not found.');
    return { id };
  }

  async checkout(userId: string, dto: CheckoutDto) {
    const cartItems = await this.prisma.commerceCartItem.findMany({
      where: { userId },
    });
    const submittedItems = dto.items ?? [];
    const orderItems = submittedItems.length
      ? await Promise.all(
          submittedItems.map(async (item) => {
            const product = await this.prisma.product.findFirst({
              where: {
                id: item.productId,
                status: 'ACTIVE',
                vendorProfile: { setupCompleted: true },
              },
              include: {
                vendorProfile: { select: { storeName: true, userId: true } },
              },
            });
            if (!product) {
              throw new NotFoundException(
                `${item.name || 'A product'} is no longer available.`,
              );
            }
            if (item.quantity > product.quantity) {
              throw new BadRequestException(
                `${product.name} does not have enough stock.`,
              );
            }
            return {
              deliveryAddress: dto.address.label,
              imageUri: product.imageUrls[0] ?? item.imageUri,
              name: product.name,
              originalPrice: product.promoPrice ? product.unitPrice : null,
              productId: product.id,
              quantity: item.quantity,
              selectedColor: item.selectedColor,
              selectedSize: item.selectedSize,
              selectedVariants: item.selectedVariants ?? {},
              sku: product.id,
              subtitle: item.subtitle,
              unitPrice: product.promoPrice ?? product.unitPrice,
              vendorId: product.vendorProfile.userId,
              vendorName: product.vendorProfile.storeName,
            };
          }),
        )
      : cartItems.map((item) => ({
          deliveryAddress: item.deliveryAddress,
          imageUri: item.imageUri,
          name: item.name,
          originalPrice: item.originalPrice,
          productId: item.productId,
          quantity: item.quantity,
          selectedColor: item.selectedColor,
          selectedSize: item.selectedSize,
          selectedVariants: item.selectedVariants ?? {},
          sku: item.sku,
          subtitle: item.subtitle,
          unitPrice: item.unitPrice,
          vendorId: item.vendorId,
          vendorName: item.vendorName,
        }));
    if (!orderItems.length)
      throw new BadRequestException('Your cart is empty.');
    const itemCount = orderItems.reduce((sum, item) => sum + item.quantity, 0);
    if (itemCount !== dto.itemCount) {
      throw new BadRequestException(
        'Your cart changed. Review it before checking out.',
      );
    }
    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const total = subtotal + SERVICE_FEE + DELIVERY_FEE;
    const order = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.commerceOrder.create({
        data: {
          deliveryAddress: dto.address.label,
          deliveryFee: DELIVERY_FEE,
          latitude: dto.address.latitude,
          longitude: dto.address.longitude,
          paymentMethod: dto.paymentMethod,
          serviceFee: SERVICE_FEE,
          subtotal,
          total,
          userId,
          items: {
            create: orderItems,
          },
        },
      });
      await transaction.commerceCartItem.deleteMany({ where: { userId } });
      return created;
    });
    return { id: order.id, total: order.total };
  }

  async completeOrder(userId: string, id: string) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id, userId },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status === 'delivered' && order.completedAt) {
      return { completedAt: order.completedAt.toISOString(), id };
    }
    const completedAt = new Date();
    await this.prisma.commerceOrder.update({
      where: { id },
      data: { completedAt, status: 'delivered' },
    });
    return { completedAt: completedAt.toISOString(), id };
  }

  async reportIssue(userId: string, dto: ReportOrderIssueDto) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id: dto.orderId, userId },
      include: { items: { select: { id: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (dto.itemId && !order.items.some((item) => item.id === dto.itemId)) {
      throw new BadRequestException(
        'The selected item is not part of this order.',
      );
    }
    const issue = await this.prisma.orderIssue.create({
      data: { ...dto, description: dto.description.trim(), userId },
    });
    return {
      id: issue.id,
      orderId: issue.orderId,
      status: 'reported' as const,
    };
  }

  async createReturn(userId: string, dto: CreateReturnDto) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id: dto.orderId, userId },
      include: { items: true, returnRequests: { select: { id: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status !== 'delivered') {
      throw new BadRequestException('Only delivered orders can be returned.');
    }
    if (order.returnRequests.length) {
      throw new BadRequestException(
        'A return has already been requested for this order.',
      );
    }
    for (const requested of dto.items) {
      const item = order.items.find((entry) => entry.id === requested.itemId);
      if (!item || requested.quantity > item.quantity) {
        throw new BadRequestException(
          'Check the selected return items and quantities.',
        );
      }
    }
    const request = await this.prisma.returnRequest.create({
      data: {
        description: dto.description.trim(),
        orderId: dto.orderId,
        reason: dto.reason,
        userId,
        items: {
          create: dto.items.map((item) => ({
            orderItemId: item.itemId,
            quantity: item.quantity,
          })),
        },
      },
    });
    return {
      id: request.id,
      orderId: request.orderId,
      status: 'requested' as const,
    };
  }
}
