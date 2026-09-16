import { BadRequestException, ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { CreateSupportTicketDto, SupportListDto, SupportMessageDto, SupportStatusDto } from './dto/support.dto';
import { parseSupportAttachments, readSupportAttachment, removeSupportAttachments, saveSupportAttachments } from './support-upload';

const senderInclude = { sender: { select: { firstName: true, lastName: true } } };
type Message = Prisma.SupportMessageGetPayload<{ include: typeof senderInclude }>;
export type SupportAudience = 'seller' | 'admin';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async authorize(userId: string, audience: SupportAudience) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true, vendorProfile: { select: { id: true } } } });
    if (!user?.isActive || (audience === 'admin' ? user.role !== 'ADMIN' : !user.vendorProfile)) {
      throw new ForbiddenException(audience === 'admin' ? 'Administrator access required.' : 'Seller access required.');
    }
  }

  async requireTicket(userId: string, ticketId: string, audience: SupportAudience) {
    await this.authorize(userId, audience);
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, ...(audience === 'seller' ? { ownerUserId: userId } : {}) } });
    if (!ticket) throw new NotFoundException('Support ticket not found.');
    return ticket;
  }

  async contact(userId: string) {
    await this.authorize(userId, 'seller');
    return { phone: process.env.SUPPORT_PHONE?.trim() || null, email: process.env.SUPPORT_EMAIL?.trim() || null };
  }

  private mapMessage(message: Message, userId: string, audience: SupportAudience) {
    return {
      id: message.id, ticketId: message.ticketId, senderUserId: message.senderUserId,
      senderRole: message.senderRole, senderName: [message.sender.firstName, message.sender.lastName].filter(Boolean).join(' ') || (message.senderRole === 'admin' ? 'Support team' : 'Seller'),
      text: message.text, createdAt: message.createdAt.toISOString(), direction: message.senderUserId === userId ? 'outgoing' : 'incoming',
      attachments: parseSupportAttachments(message.attachments).map(file => ({ ...file, url: `/${audience}/support/tickets/${message.ticketId}/messages/${message.id}/attachments/${file.id}` })),
    };
  }

  async list(userId: string, query: SupportListDto, audience: SupportAudience) {
    await this.authorize(userId, audience);
    const where = { ...(audience === 'seller' ? { ownerUserId: userId } : {}), ...(query.status ? { status: query.status } : {}) };
    const [tickets, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return { tickets, total, page: query.page, limit: query.limit };
  }

  async detail(userId: string, ticketId: string, audience: SupportAudience) {
    const ticket = await this.requireTicket(userId, ticketId, audience);
    const messages = await this.prisma.supportMessage.findMany({ where: { ticketId }, include: senderInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { ...ticket, messages: messages.map(message => this.mapMessage(message, userId, audience)) };
  }

  async create(userId: string, dto: CreateSupportTicketDto) {
    await this.authorize(userId, 'seller');
    if (!dto.category?.trim() || !dto.subject?.trim()) throw new BadRequestException('Category and subject are required.');
    if (dto.orderId) {
      const order = await this.prisma.commerceOrder.findFirst({ where: { id: dto.orderId, items: { some: { vendorId: userId } } }, select: { id: true } });
      if (!order) throw new NotFoundException('Order not found for this seller.');
    }
    const ticket = await this.prisma.supportTicket.create({ data: {
      ownerUserId: userId, orderId: dto.orderId, category: dto.category.trim(), subject: dto.subject.trim(),
      ...(dto.text?.trim() ? { messages: { create: { senderUserId: userId, senderRole: 'seller', text: dto.text.trim() } } } : {}),
    } });
    return this.detail(userId, ticket.id, 'seller');
  }

  async send(userId: string, ticketId: string, dto: SupportMessageDto, files: Express.Multer.File[], audience: SupportAudience) {
    await this.requireTicket(userId, ticketId, audience);
    if (!dto.text?.trim() && !files.length) throw new BadRequestException('Enter a message or attach a file.');
    const attachments = await saveSupportAttachments(files);
    let message: Message;
    try {
      message = await this.prisma.$transaction(async tx => {
        const created = await tx.supportMessage.create({ data: { ticketId, senderUserId: userId, senderRole: audience, text: dto.text?.trim() || null, attachments }, include: senderInclude });
        await tx.supportTicket.update({ where: { id: ticketId }, data: { updatedAt: created.createdAt, ...(audience === 'seller' ? { status: 'open' } : {}) } });
        return created;
      });
    } catch (error) {
      await removeSupportAttachments(attachments);
      throw error;
    }
    return this.mapMessage(message, userId, audience);
  }

  async status(userId: string, ticketId: string, dto: SupportStatusDto) {
    await this.requireTicket(userId, ticketId, 'admin');
    return this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: dto.status } });
  }

  async attachment(userId: string, ticketId: string, messageId: string, attachmentId: string, audience: SupportAudience) {
    await this.requireTicket(userId, ticketId, audience);
    const message = await this.prisma.supportMessage.findFirst({ where: { id: messageId, ticketId }, select: { attachments: true } });
    const attachment = parseSupportAttachments(message?.attachments).find(file => file.id === attachmentId);
    if (!attachment) throw new NotFoundException('Attachment not found.');
    let data: Buffer;
    try { data = await readSupportAttachment(attachment); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException('Attachment file not found.');
      throw error;
    }
    return new StreamableFile(data, { type: attachment.mimeType, length: data.length, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/'/g, '%27')}` });
  }
}
