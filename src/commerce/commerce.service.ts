import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
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
import * as crypto from 'node:crypto';
const SERVICE_FEE = 6;
const DELIVERY_FEE = 13;

function sameVariants(left: unknown, right: unknown) {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
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
  constructor(private readonly prisma: PrismaService) { }

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
    subtotal: number;
    serviceFee: number;
    deliveryFee: number;
    total: number;
    items: Parameters<CommerceService['mapItem']>[0][];
    issues: { id: string }[];
    returnRequests: { id: string }[];
    trustReviews: { vendorProfile: { userId: string } }[];
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
          issues: { select: { id: true } },
          returnRequests: { select: { id: true } },
          trustReviews: {
            select: { vendorProfile: { select: { userId: true } } },
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
      imageUri: product.imageUrls[0] ?? dto.imageUri ?? '',
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
    const requestedItems = dto.cartSelection ?? [];
    const requestedIds = requestedItems.map((item) => item.cartItemId);

    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException(
        'A cart item was submitted more than once.',
      );
    }

    const isPayOnDelivery = dto.paymentMethod === 'pay_on_delivery';

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!isPayOnDelivery && !user?.email) {
      throw new BadRequestException(
        'A valid email address is required to make payment.',
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

        if (
          !Number.isInteger(requested.quantity) ||
          requested.quantity < 1
        ) {
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
      console.log('Checkout stock check:', {
        product: product.name,
        productId: product.id,
        requestedQuantity: quantity,
        availableStock: product.quantity,
      });

      if (quantity > product.quantity) {
        throw new BadRequestException(
          `${product.name} does not have enough stock.`,
        );
      }

      const promoPrice = activePromoPrice(product);


      return {
        sourceCartItemId: cartItem.id,
        deliveryAddress: dto.address.label,
        imageUri: product.imageUrls[0] ?? cartItem.imageUri ?? '',
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

    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0,
    );
    const total = subtotal + SERVICE_FEE + DELIVERY_FEE;
    const reference = `WHZ-${crypto.randomUUID()}`;


    const order = await this.prisma.$transaction(async (transaction) => {
      const createdOrder = await transaction.commerceOrder.create({
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
          status: isPayOnDelivery ? 'confirmed' : 'pending_payment',
          paymentStatus: 'pending',
          paymentReference: reference,
          items: {
            create: orderItems,
          },
        },
        include: {
          items: true,
        },
      });

      if (isPayOnDelivery) {
        // Create one fulfillment per seller.
        const vendorIds = [
          ...new Set(createdOrder.items.map((item) => item.vendorId)),
        ];

        for (const vendorId of vendorIds) {
          await transaction.sellerFulfillment.upsert({
            where: {
              orderId_vendorId: {
                orderId: createdOrder.id,
                vendorId,
              },
            },
            create: {
              orderId: createdOrder.id,
              vendorId,
              status: 'pending',
              history: {
                create: {
                  status: 'pending',
                  actorUserId: userId,
                },
              },
            },
            update: {},
          });
        }

        // Remove only the cart items included in this order.
        const sourceCartItemIds = createdOrder.items
          .map((item) => item.sourceCartItemId)
          .filter((id): id is string => id !== null);

        if (sourceCartItemIds.length > 0) {
          await transaction.commerceCartItem.deleteMany({
            where: {
              userId,
              id: { in: sourceCartItemIds },
            },
          });
        }
      }

      return createdOrder;
    });

    if (isPayOnDelivery) {
      return {
        id: order.id,
        paymentStatus: 'pending',
        paymentMethod: 'pay_on_delivery',
        total: order.total,
        reference,
        authorizationUrl: null,
      };
    }


    const payment = await this.initializePaystackPayment({
      email: user!.email!,
      amount: order.total,
      reference,
      orderId: order.id,
    });

    return {
      id: order.id,
      paymentStatus: 'pending',
      paymentMethod: dto.paymentMethod,
      total: order.total,
      reference: payment.reference,
      authorizationUrl: payment.authorizationUrl,
    };

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
    const requestedIds = dto.items.map((item) => item.productId);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException('A product was submitted more than once',);
    }
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
    if (products.length !== requestedIds.length) {
      throw new BadRequestException('One of the products is no longer available.',);
    }
    const productById = new Map(products.map((product) => [product.id, product]));


    const orderItems = dto.items.map((requested) => {
      const product = productById.get(requested.productId)!;


      if (product.status !== 'ACTIVE' || !product.vendorProfile.setupCompleted || !product.vendorProfile.user.isActive) {
        throw new NotFoundException(`${product.name || 'A product'} is no longer available.`,);
      }
      if (requested.quantity > product.quantity) {
        throw new BadRequestException(`${product.name} does not have enough stock.`,);
      }
      const promoPrice = activePromoPrice(product);

      return {
        deliveryAddress: dto.address.label,
        imageUri: product.imageUrls[0] ?? '',
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
    const subtotal = orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0,);

    const total = subtotal + SERVICE_FEE + DELIVERY_FEE;
    const reference = `WHZ-${crypto.randomUUID()}`;

    const isPayOnDelivery = dto.paymentMethod === 'pay_on_delivery';

    const order = await this.prisma.$transaction(async (transaction) => {
      const createdOrder = await transaction.commerceOrder.create({
        data: {
          guestFirstName: dto.firstName.trim(),
          guestLastName: dto.lastName.trim(),
          guestEmail: dto.email.trim().toLowerCase(),
          guestPhone: dto.phone.trim(),
          deliveryAddress: dto.address.label,
          latitude: dto.address.latitude,
          longitude: dto.address.longitude,
          paymentMethod: dto.paymentMethod,
          serviceFee: SERVICE_FEE,
          deliveryFee: DELIVERY_FEE,
          subtotal,
          total,
          status: isPayOnDelivery ? 'confirmed' : 'pending_payment',
          paymentStatus: 'pending',
          paymentReference: reference,
          items: {
            create: orderItems,
          },
        },
        include: {
          items: true,
        },
      });

      if (isPayOnDelivery) {
        const vendorIds = [
          ...new Set(createdOrder.items.map((item) => item.vendorId)),
        ];

        for (const vendorId of vendorIds) {
          await transaction.sellerFulfillment.upsert({
            where: {
              orderId_vendorId: {
                orderId: createdOrder.id,
                vendorId,
              },
            },
            create: {
              orderId: createdOrder.id,
              vendorId,
              status: 'pending',
              history: {
                create: {
                  status: 'pending',
                  actorUserId: null,
                },
              },
            },
            update: {},
          });
        }
      }

      return createdOrder;
    });

    if (isPayOnDelivery) {
      return {
        id: order.id,
        paymentStatus: 'pending',
        paymentMethod: 'pay_on_delivery',
        total: order.total,
        reference,
        authorizationUrl: null,
      };
    }



    if (dto.paymentMethod === 'pay_on_delivery') {
      return {
        id: order.id,
        paymentStatus: 'pending',
        paymentMethod: 'pay_on_delivery',
        total: order.total,
        reference,
        authorizationUrl: null,
      };
    }

    const payment = await this.initializePaystackPayment({
      email: order.guestEmail!,
      amount: order.total,
      reference,
      orderId: order.id,
    });

    return {
      id: order.id,
      paymentStatus: 'pending',
      paymentMethod: dto.paymentMethod,
      total: order.total,
      reference: payment.reference,
      authorizationUrl: payment.authorizationUrl,
    };


  }

  private async initializePaystackPayment(params: { email: string, amount: number; reference: string; orderId: string; }) {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    const frontendUrl = process.env.FRONTEND_URL;

    if (!secretKey || !frontendUrl) {
      throw new InternalServerErrorException('Payment configuration is missing.',);
    }
    const response = await fetch('https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: params.email,
          amount: String(params.amount * 100),
          currency: 'NGN',
          reference: params.reference,
          callback_url: `${frontendUrl}/checkout/payment/callback`,
          metadata: {
            orderId: params.orderId,
          },
        }),
      },

    );
    const result = await response.json();
    if (!response.ok || !result.status || !result.data?.authorization_url) {

      throw new InternalServerErrorException('Unable to initialize payment wiyth Paystack');
    }

    return {
      authorizationUrl: result.data.authorization_url as string,
      reference: result.data.reference as string,
    };
  }


  async verifyPaystackPayment(reference: string) {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      throw new InternalServerErrorException(
        'Payment configuration is missing.',
      );
    }

    const order = await this.prisma.commerceOrder.findUnique({
      where: { paymentReference: reference },
      include: {
        items: true,
        fulfillments: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    // A repeated callback must not process the order again.
    if (order.paymentStatus === 'paid') {
      return {
        id: order.id,
        paymentStatus: 'paid',
        status: order.status,
        total: order.total,
      };
    }

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      },
    );

    if (!response.ok) {
      throw new BadGatewayException(
        'Unable to verify payment with Paystack.',
      );
    }

    const result = await response.json();
    const transaction = result.data;

    if (
      !result.status ||
      transaction?.status !== 'success' ||
      transaction.reference !== order.paymentReference ||
      transaction.amount !== order.total * 100 ||
      transaction.currency !== 'NGN'
    ) {
      throw new BadRequestException(
        'Payment has not been successfully verified.',
      );
    }

    // The payment has been verified. We will complete the
    // order-processing transaction after checking your
    // SellerFulfillment schema in the next step.
    const updatedOrder = await this.prisma.$transaction(
      async (transaction) => {
        const currentOrder =
          await transaction.commerceOrder.findUnique({
            where: { id: order.id },
            include: {
              items: true,
            },
          });

        if (!currentOrder) {
          throw new NotFoundException('Order not found.');
        }

        // Another callback may already have completed this order.
        if (currentOrder.paymentStatus === 'paid') {
          return currentOrder;
        }

        const paidOrder =
          await transaction.commerceOrder.update({
            where: { id: currentOrder.id },
            data: {
              paymentStatus: 'paid',
              status: 'confirmed',
            },
          });

        const vendorIds = [
          ...new Set(
            currentOrder.items.map((item) => item.vendorId),
          ),
        ];
        if (currentOrder.userId) {
          const sourceCartItemIds = currentOrder.items
            .map((item) => item.sourceCartItemId)
            .filter((id): id is string => id !== null);

          if (sourceCartItemIds.length > 0) {
            await transaction.commerceCartItem.deleteMany({
              where: {
                userId: currentOrder.userId,
                id: { in: sourceCartItemIds },
              },
            });
          }
        }

        for (const vendorId of vendorIds) {
          await transaction.sellerFulfillment.upsert({
            where: {
              orderId_vendorId: {
                orderId: currentOrder.id,
                vendorId,
              },
            },
            create: {
              orderId: currentOrder.id,
              vendorId,
              status: 'pending',
              history: {
                create: {
                  status: 'pending',
                  actorUserId: currentOrder.userId,
                },
              },
            },
            update: {},
          });
        }

        return paidOrder;
      },
    );

    return {
      id: updatedOrder.id,
      paymentStatus: updatedOrder.paymentStatus,
      status: updatedOrder.status,
      total: updatedOrder.total,
    };
  }





}

