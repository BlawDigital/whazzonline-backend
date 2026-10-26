import { variantImage } from '../common/product-options';
import { GoodsInvoicesService } from '../invoices/goods-invoices.service';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from 'prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { productSku } from '../common/product-sku';
import { CreateReturnDto } from './dto/create-return.dto';
import { CreateTrustReviewDto } from './dto/create-trust-review.dto';
import { ReportOrderIssueDto } from './dto/report-order-issue.dto';
import { GuestCheckoutDto } from './dto/guest-checkout.dto';
import { lockOrder } from './fulfillment';
import { normalizeOrderStatus } from './order-status';
import { BUYER_RECEIPT_REASON, buyerReceiptDate } from './buyer-receipt';

// Delivery charges will now need to be agreed on the merchant invoice side; no platform shipping charge for now.
const DELIVERY_FEE = 0;

function sameVariants(left: unknown, right: unknown) {
  const sorted = (value: unknown) =>
    value && typeof value === 'object'
      ? Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      : [];
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function activePromoPrice(product: {
  promoEndsAt: Date | null;
  promoPrice: number | null;
  promoStartsAt: Date | null;
}) {
  const now = Date.now();
  return product.promoPrice &&
    product.promoStartsAt &&
    product.promoEndsAt &&
    product.promoStartsAt.getTime() <= now &&
    product.promoEndsAt.getTime() > now
    ? product.promoPrice
    : null;
}

@Injectable()
export class CommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: GoodsInvoicesService = new GoodsInvoicesService(
      prisma,
    ),
  ) {}

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
      deliveryAddress: item.deliveryAddress,
      id: item.id,
      imageUri: item.imageUri,
      name: item.name,
      originalPrice: item.originalPrice ?? undefined,
      productId: item.productId,
      quantity: item.quantity,
      selectedColor: item.selectedColor ?? undefined,
      selectedSize: item.selectedSize ?? undefined,
      selectedVariants: (item.selectedVariants ?? {}) as Record<string, string>,
      sku: item.sku,
      subtitle: item.subtitle,
      unitPrice: item.unitPrice,
      vendorId: item.vendorId,
      vendorName: item.vendorName,
    };
  }

  private mapOrder(order: {
    id: string;
    createdAt: Date;
    completedAt: Date | null;
    deliveryAddress: string;
    status: string;
    paymentStatus?: string;
    paymentMethod?: string;
    subtotal: number;
    serviceFee: number;
    deliveryFee: number;
    total: number;
    items: Parameters<CommerceService['mapItem']>[0][];
    invoices?: {
      id: string;
      number: string;
      vendorId: string;
      status: string;
      total: number;
    }[];
    issues: { id: string }[];
    returnRequests: { id: string }[];
    trustReviews: { vendorProfile: { userId: string } }[];
    fulfillments?: {
      vendorId: string;
      status: string;
      history: { createdAt: Date }[];
    }[];
  }) {
    return {
      completedAt: order.completedAt?.toISOString(),
      buyerConfirmedAt: buyerReceiptDate(order.fulfillments ?? []),
      reviewableVendorIds: order.fulfillments?.length
        ? order.fulfillments
            .filter((row) => normalizeOrderStatus(row.status) !== 'rejected')
            .map((row) => row.vendorId)
        : [...new Set(order.items.map((item) => item.vendorId))],
      createdAt: order.createdAt.toISOString(),
      deliveryAddress: order.deliveryAddress,
      id: order.id,
      invoices: order.invoices ?? [],
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
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      total: order.total,
      trustedVendorIds: order.trustReviews.map(
        (review) => review.vendorProfile.userId,
      ),
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
          invoices: {
            select: {
              id: true,
              number: true,
              vendorId: true,
              status: true,
              total: true,
            },
          },
          issues: { select: { id: true } },
          returnRequests: { select: { id: true } },
          trustReviews: {
            select: { vendorProfile: { select: { userId: true } } },
          },
          fulfillments: {
            select: {
              vendorId: true,
              status: true,
              history: {
                where: { actorUserId: userId, reason: BUYER_RECEIPT_REASON },
                select: { createdAt: true },
                orderBy: { createdAt: 'asc' },
                take: 1,
              },
            },
          },
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

    const promoPrice = activePromoPrice(product);
    const unitPrice = promoPrice ?? product.unitPrice;
    const data = {
      deliveryAddress: dto.deliveryAddress,
      imageUri: variantImage(
        product,
        dto.selectedVariants,
        dto.selectedColor,
        dto.selectedSize,
      ),
      name: product.name,
      originalPrice: promoPrice ? product.unitPrice : null,
      productId: product.id,
      quantity: nextQuantity,
      selectedColor: dto.selectedColor,
      selectedSize: dto.selectedSize,
      selectedVariants: variants,
      sku: productSku(product.id),
      subtitle: dto.subtitle ?? product.category,
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
    const resumed = await this.invoices.resume(userId, dto.idempotencyKey);
    if (resumed) return resumed;
    const requestedItems = dto.cartSelection ?? [];
    const requestedIds = requestedItems.map((item) => item.cartItemId);

    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException(
        'A cart item was submitted more than once.',
      );
    }

    const cartItems = await this.prisma.commerceCartItem.findMany({
      where: {
        userId,
        ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
      },
      include: {
        product: {
          include: {
            vendorProfile: {
              select: {
                setupCompleted: true,
                storeName: true,
                userId: true,
                user: { select: { isActive: true } },
              },
            },
          },
        },
      },
    });

    if (requestedIds.length && cartItems.length !== requestedIds.length) {
      throw new BadRequestException(
        'One of the displayed cart items is no longer available. Return to your cart and try again.',
      );
    }

    const cartById = new Map(cartItems.map((item) => [item.id, item]));

    const selectedItems = requestedItems.length
      ? requestedItems.map((requested) => {
          const cartItem = cartById.get(requested.cartItemId);

          if (!cartItem) {
            throw new BadRequestException(
              'A selected cart item is no longer available.',
            );
          }

          if (!Number.isInteger(requested.quantity) || requested.quantity < 1) {
            throw new BadRequestException('Invalid item quantity.');
          }

          return { cartItem, quantity: requested.quantity };
        })
      : cartItems.map((cartItem) => ({
          cartItem,
          quantity: cartItem.quantity,
        }));

    const orderItems = selectedItems.map(({ cartItem, quantity }) => {
      const product = cartItem.product;

      if (
        product.status !== 'ACTIVE' ||
        !product.vendorProfile.setupCompleted ||
        !product.vendorProfile.user.isActive
      ) {
        throw new NotFoundException(
          `${product.name || 'A product'} is no longer available.`,
        );
      }

      if (quantity > product.quantity) {
        throw new BadRequestException(
          `${product.name} does not have enough stock.`,
        );
      }

      const promoPrice = activePromoPrice(product);

      return {
        sourceCartItemId: cartItem.id,
        deliveryAddress: dto.address.label,
        imageUri: variantImage(
          product,
          cartItem.selectedVariants,
          cartItem.selectedColor,
          cartItem.selectedSize,
        ),
        name: product.name,
        originalPrice: promoPrice ? product.unitPrice : null,
        productId: product.id,
        quantity,
        selectedColor: cartItem.selectedColor,
        selectedSize: cartItem.selectedSize,
        selectedVariants: cartItem.selectedVariants ?? {},
        sku: productSku(product.id),
        subtitle: cartItem.subtitle || product.category,
        unitPrice: promoPrice ?? product.unitPrice,
        vendorId: product.vendorProfile.userId,
        vendorName: product.vendorProfile.storeName,
      };
    });

    if (!orderItems.length) {
      throw new BadRequestException('Your cart is empty.');
    }

    return this.invoices.createCheckout({
      userId,
      address: dto.address,
      paymentMethod: dto.paymentMethod,
      lines: orderItems,
      deliveryFee: DELIVERY_FEE,
      idempotencyKey: dto.idempotencyKey,
    });
  }
  async productLikes(userId: string) {
    const likes = await this.prisma.productLike.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { productId: true },
    });
    return { productIds: likes.map((like) => like.productId) };
  }

  async likeProduct(userId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        status: 'ACTIVE',
        vendorProfile: { setupCompleted: true },
      },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
    await this.prisma.productLike.upsert({
      where: { userId_productId: { productId, userId } },
      create: { productId, userId },
      update: {},
    });
    const likeCount = await this.prisma.productLike.count({
      where: { productId },
    });
    return { liked: true, likeCount, productId };
  }

  async unlikeProduct(userId: string, productId: string) {
    await this.prisma.productLike.deleteMany({ where: { productId, userId } });
    const likeCount = await this.prisma.productLike.count({
      where: { productId },
    });
    return { liked: false, likeCount, productId };
  }

  async completeOrder(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const order = await tx.commerceOrder.findFirst({
        where: { id, userId },
        include: { items: { select: { vendorId: true } } },
      });
      if (!order) throw new NotFoundException('Order not found.');
      if (order.paymentStatus !== 'paid')
        throw new BadRequestException(
          'Payment must be confirmed before completing the order.',
        );
      if (
        !['processing', 'ready', 'out_for_delivery', 'delivered'].includes(
          normalizeOrderStatus(order.status),
        )
      ) {
        throw new BadRequestException(
          'Only an accepted order can be confirmed as delivered.',
        );
      }
      const completedAt = order.completedAt ?? new Date();
      const fulfillments = await tx.sellerFulfillment.findMany({
        where: { orderId: id },
        include: {
          history: {
            where: { actorUserId: userId, reason: BUYER_RECEIPT_REASON },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
      });
      const confirmed = buyerReceiptDate(fulfillments);
      if (
        confirmed &&
        order.items.every((item) =>
          fulfillments.some((row) => row.vendorId === item.vendorId),
        )
      )
        return {
          id,
          completedAt: completedAt.toISOString(),
          buyerConfirmedAt: confirmed,
        };
      const confirmedAt = new Date();
      for (const vendorId of new Set(
        order.items.map((item) => item.vendorId),
      )) {
        if (fulfillments.some((row) => row.vendorId === vendorId)) continue;
        fulfillments.push(
          await tx.sellerFulfillment.create({
            data: {
              orderId: id,
              vendorId,
              status: 'delivered',
              history: {
                create: {
                  status: 'delivered',
                  actorUserId: userId,
                  reason: BUYER_RECEIPT_REASON,
                  createdAt: confirmedAt,
                },
              },
            },
            include: {
              history: {
                where: { actorUserId: userId, reason: BUYER_RECEIPT_REASON },
                orderBy: { createdAt: 'asc' },
                take: 1,
              },
            },
          }),
        );
      }
      for (const fulfillment of fulfillments) {
        if (
          normalizeOrderStatus(fulfillment.status) === 'rejected' ||
          fulfillment.history.length
        )
          continue;
        await tx.sellerFulfillment.update({
          where: { id: fulfillment.id },
          data: {
            status: 'delivered',
            history: {
              create: {
                status: 'delivered',
                actorUserId: userId,
                reason: BUYER_RECEIPT_REASON,
                createdAt: confirmedAt,
              },
            },
          },
        });
      }
      await tx.commerceOrder.update({
        where: { id },
        data: { completedAt, status: 'delivered' },
      });
      return {
        completedAt: completedAt.toISOString(),
        buyerConfirmedAt: confirmedAt.toISOString(),
        id,
      };
    });
  }

  async reportIssue(userId: string, dto: ReportOrderIssueDto) {
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id: dto.orderId, userId },
      include: { items: { select: { id: true, productId: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    const orderItem = dto.itemId
      ? (order.items.find((item) => item.id === dto.itemId) ??
        order.items.find((item) => item.productId === dto.productId))
      : dto.productId
        ? order.items.find((item) => item.productId === dto.productId)
        : undefined;
    if ((dto.itemId || dto.productId) && !orderItem) {
      throw new BadRequestException(
        'The selected item is not part of this order.',
      );
    }
    const issue = await this.prisma.orderIssue.create({
      data: {
        description: dto.description.trim(),
        itemId: orderItem?.id,
        orderId: dto.orderId,
        type: dto.type,
        userId,
      },
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
      const item =
        order.items.find((entry) => entry.id === requested.itemId) ??
        order.items.find((entry) => entry.productId === requested.productId);
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
          create: dto.items.map((requested) => {
            const item =
              order.items.find((entry) => entry.id === requested.itemId) ??
              order.items.find(
                (entry) => entry.productId === requested.productId,
              );
            if (!item) {
              throw new BadRequestException(
                'Check the selected return items and quantities.',
              );
            }
            return { orderItemId: item.id, quantity: requested.quantity };
          }),
        },
      },
    });
    return {
      id: request.id,
      orderId: request.orderId,
      status: 'requested' as const,
    };
  }

  async createTrustReview(userId: string, dto: CreateTrustReviewDto) {
    const reason = dto.reason.trim();
    if (reason.length < 10) {
      throw new BadRequestException(
        'Explain why you trust this seller in at least 10 characters.',
      );
    }
    const order = await this.prisma.commerceOrder.findFirst({
      where: { id: dto.orderId, userId },
      include: { items: { select: { vendorId: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status !== 'delivered') {
      throw new BadRequestException(
        'Trust reviews can only be submitted after delivery.',
      );
    }
    if (!order.items.some((item) => item.vendorId === dto.vendorId)) {
      throw new BadRequestException(
        'This seller is not part of the selected order.',
      );
    }

    const vendorProfile = await this.prisma.vendorProfile.findUnique({
      where: { userId: dto.vendorId },
      select: { id: true },
    });
    if (!vendorProfile) throw new NotFoundException('Seller not found.');
    const existing = await this.prisma.vendorTrustReview.findUnique({
      where: {
        reviewerUserId_vendorProfileId_orderId: {
          orderId: order.id,
          reviewerUserId: userId,
          vendorProfileId: vendorProfile.id,
        },
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        'You have already reviewed this seller for this order.',
      );
    }

    const review = await this.prisma.vendorTrustReview.create({
      data: {
        orderId: order.id,
        reason,
        ...(dto.rating === undefined ? {} : { rating: dto.rating }),
        reviewerUserId: userId,
        vendorProfileId: vendorProfile.id,
      },
    });
    const trustCount = await this.prisma.vendorTrustReview.count({
      where: { vendorProfileId: vendorProfile.id },
    });
    return {
      createdAt: review.createdAt.toISOString(),
      id: review.id,
      orderId: review.orderId,
      reason: review.reason,
      trustCount,
      vendorId: dto.vendorId,
    };
  }

  //Guest checkout
  async guestCheckout(dto: GuestCheckoutDto) {
    const resumed = await this.invoices.resume(
      undefined,
      dto.idempotencyKey,
      dto.guestAccessToken,
    );
    if (resumed) return resumed;
    const requestedIds = dto.items.map((item) => item.productId);
    const selectionKeys = dto.items.map(
      (item) =>
        `${item.productId}:${item.selectedColor ?? ''}:${item.selectedSize ?? ''}:${JSON.stringify(Object.entries(item.selectedVariants ?? {}).sort(([a], [b]) => a.localeCompare(b)))}`,
    );
    if (new Set(selectionKeys).size !== selectionKeys.length)
      throw new BadRequestException(
        'A product option was submitted more than once',
      );
    const products = await this.prisma.product.findMany({
      where: { id: { in: requestedIds } },
      include: {
        vendorProfile: {
          select: {
            setupCompleted: true,
            storeName: true,
            userId: true,
            user: { select: { isActive: true } },
          },
        },
      },
    });
    if (products.length !== new Set(requestedIds).size) {
      throw new BadRequestException(
        'One of the products is no longer available.',
      );
    }
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );

    const orderItems = dto.items.map((requested) => {
      const product = productById.get(requested.productId)!;

      if (
        product.status !== 'ACTIVE' ||
        !product.vendorProfile.setupCompleted ||
        !product.vendorProfile.user.isActive
      ) {
        throw new NotFoundException(
          `${product.name || 'A product'} is no longer available.`,
        );
      }
      if (requested.quantity > product.quantity) {
        throw new BadRequestException(
          `${product.name} does not have enough stock.`,
        );
      }
      const promoPrice = activePromoPrice(product);

      return {
        deliveryAddress: dto.address.label,
        imageUri: variantImage(
          product,
          requested.selectedVariants,
          requested.selectedColor,
          requested.selectedSize,
        ),
        name: product.name,
        originalPrice: promoPrice ? product.unitPrice : null,
        productId: product.id,
        quantity: requested.quantity,
        selectedColor: requested.selectedColor ?? null,
        selectedSize: requested.selectedSize ?? null,
        selectedVariants: requested.selectedVariants ?? {},
        sku: productSku(product.id),
        subtitle: product.category,
        unitPrice: promoPrice ?? product.unitPrice,
        vendorId: product.vendorProfile.userId,
        vendorName: product.vendorProfile.storeName,
      };
    });
    return this.invoices.createCheckout({
      guest: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone.trim(),
      },
      guestAccessToken: dto.guestAccessToken,
      idempotencyKey: dto.idempotencyKey,
      address: dto.address,
      paymentMethod: dto.paymentMethod,
      lines: orderItems,
      deliveryFee: DELIVERY_FEE,
    });
  }
  async verifyPaystackPayment(reference: string) {
    const order = await this.prisma.commerceOrder.findUnique({
      where: { paymentReference: reference },
    });
    if (order?.paymentStatus === 'paid')
      return {
        id: order.id,
        paymentStatus: 'paid',
        status: order.status,
        total: order.total,
      };
    throw new BadRequestException(
      'Goods payments must use the merchant invoice. Whazzonline goods checkout is no longer available.',
    );
  }
}
