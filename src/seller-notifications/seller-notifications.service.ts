import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { SellerOrdersService } from '../commerce/seller-orders.service';
import { NotificationSettingsDto } from './dto/notification.dto';

type Notice = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  type: string;
  orderId?: string;
  productId?: string;
};
const defaults = {
  orders: true,
  priceSuggestions: true,
  inventoryAlerts: true,
};
@Injectable()
export class SellerNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: SellerOrdersService,
  ) {}
  private async authorize(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { registrationType: true },
    });
    if (!user || !['SELLER', 'BUSINESS'].includes(user.registrationType ?? ''))
      throw new ForbiddenException('Seller account required.');
  }
  async settings(userId: string) {
    await this.authorize(userId);
    return (
      (await this.prisma.sellerNotificationSettings.findUnique({
        where: { userId },
      })) ?? defaults
    );
  }
  async saveSettings(userId: string, dto: NotificationSettingsDto) {
    await this.authorize(userId);
    return this.prisma.sellerNotificationSettings.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }
  private async feed(userId: string) {
    await this.authorize(userId);
    const [orderFeed, own, peers, reads, settings] = await Promise.all([
      this.orders.notifications(userId),
      this.prisma.product.findMany({
        where: { status: 'ACTIVE', vendorProfile: { userId } },
      }),
      this.prisma.product.findMany({
        where: {
          status: 'ACTIVE',
          vendorProfile: { setupCompleted: true, userId: { not: userId } },
        },
        select: { category: true, unitPrice: true },
      }),
      this.prisma.sellerNotificationRead.findMany({
        where: { userId },
        select: { key: true },
      }),
      this.settings(userId),
    ]);
    const notices: Notice[] = settings.orders
      ? orderFeed.notifications.map((n) => ({ ...n, type: 'order' }))
      : [];
    for (const product of own) {
      if (settings.inventoryAlerts && product.quantity <= 5)
        notices.push({
          id: `inventory:${product.id}:${product.updatedAt.getTime()}`,
          title: 'Inventory alert',
          body: `${product.name} has ${product.quantity} ${product.quantity === 1 ? 'unit' : 'units'} left in stock.`,
          type: 'inventory',
          productId: product.id,
          createdAt: product.updatedAt.toISOString(),
          read: false,
        });
      const comparable = peers.filter(
        (p) => p.category.toLowerCase() === product.category.toLowerCase(),
      );
      if (settings.priceSuggestions && comparable.length >= 3) {
        const average = Math.round(
          comparable.reduce((sum, p) => sum + p.unitPrice, 0) /
            comparable.length,
        );
        notices.push({
          id: `price:${product.id}:${average}:${comparable.length}`,
          title: 'Price suggestion',
          body: `${comparable.length} similar listings in ${product.category} have an average price of ₦${average.toLocaleString('en-NG')}. Your ${product.name} is ₦${product.unitPrice.toLocaleString('en-NG')}.`,
          type: 'price',
          productId: product.id,
          createdAt: product.updatedAt.toISOString(),
          read: false,
        });
      }
    }
    const readKeys = new Set(reads.map((r) => r.key));
    return notices
      .map((n) => ({ ...n, read: n.read || readKeys.has(n.id) }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  async list(userId: string, search = '', type = '', page = 1) {
    const all = await this.feed(userId);
    const counts = {
      all: all.filter((n) => !n.read).length,
      order: all.filter((n) => n.type === 'order' && !n.read).length,
      price: all.filter((n) => n.type === 'price' && !n.read).length,
      inventory: all.filter((n) => n.type === 'inventory' && !n.read).length,
    };
    const filtered = all.filter(
      (n) =>
        (!type || n.type === type) &&
        `${n.title} ${n.body}`.toLowerCase().includes(search.toLowerCase()),
    );
    const limit = Math.max(1, Math.min(100, Math.floor(page))) * 20;
    return {
      notifications: filtered.slice(0, limit),
      unreadCount: counts.all,
      counts,
      hasMore: filtered.length > limit,
    };
  }
  async markRead(userId: string, ids?: string[]) {
    const all = await this.feed(userId);
    const allowed = new Set(all.map((n) => n.id));
    if (ids?.some((id) => !allowed.has(id)))
      throw new BadRequestException('Notification not found in your account.');
    const keys = ids ?? all.filter((n) => !n.read).map((n) => n.id);
    await this.prisma.sellerNotificationRead.createMany({
      data: keys.map((key) => ({ userId, key })),
      skipDuplicates: true,
    });
    return { success: true };
  }
}
