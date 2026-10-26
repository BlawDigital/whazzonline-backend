import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  Res,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { validFileSignature } from '../storage/cloudinary-storage';
import type { Response } from 'express';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import {
  GoodsInvoicesService,
  type InvoiceAccess,
} from './goods-invoices.service';
import {
  ChatInvoiceDto,
  MerchantOrderInvoiceDto,
  CheckoutQuoteDto,
  ConfirmInvoiceDto,
  ConnectMerchantPaymentDto,
  RejectTransferDto,
  TransferReportDto,
} from './invoice.dto';
@Controller('invoices')
export class GoodsInvoicesController {
  constructor(
    private readonly invoices: GoodsInvoicesService,
    private readonly jwt: JwtService,
  ) {}
  @Post('quote')
  quote(@Body() dto: CheckoutQuoteDto) {
    return this.invoices.quote(dto);
  }
  private async access(request: Request): Promise<InvoiceAccess> {
    const header = request.headers.authorization;
    let userId: string | undefined;
    if (header) {
      if (!header.startsWith('Bearer '))
        throw new UnauthorizedException('Invalid authentication.');
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string }>(
          header.slice(7),
        );
        userId = payload.sub;
      } catch {
        throw new UnauthorizedException('Invalid authentication.');
      }
    }
    const token = request.headers['x-invoice-token'];
    return {
      userId,
      guestToken: typeof token === 'string' ? token : undefined,
    };
  }
  @Get(':id') async get(@Param('id') id: string, @Req() req: Request) {
    return this.invoices.get(id, await this.access(req));
  }
  @Post(':id/transfer-report')
  @UseInterceptors(
    FilesInterceptor('evidence', 3, {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 3 },
      fileFilter: (_req, file, callback) =>
        callback(
          ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(
            file.mimetype,
          )
            ? null
            : new BadRequestException('Choose a PNG, JPEG, WebP or PDF file.'),
          true,
        ),
    }),
  )
  async report(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() dto: TransferReportDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const access = await this.access(req);
    if (files?.some((file) => !validFileSignature(file.buffer, file.mimetype)))
      throw new BadRequestException(
        'File content does not match its image or document type.',
      );
    return this.invoices.report(
      id,
      access,
      dto,
      (files ?? []).map((file) => ({
        name: file.originalname.replace(/[\\/\r\n]/g, '_').slice(0, 180),
        mime: file.mimetype,
        content: file.buffer,
      })),
    );
  }
  @Get(':id/evidence/:evidenceId') async evidence(
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const file = await this.invoices.transferEvidence(
      id,
      evidenceId,
      await this.access(req),
    );
    res.setHeader('Content-Type', file.mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(file.content));
  }
  @Post(':id/secure-checkout') async checkout(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.invoices.secureCheckout(id, await this.access(req));
  }
  @Post(':id/verify') async verify(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.invoices.verify(id, await this.access(req));
  }
  @Post(':id/confirm') @UseGuards(JwtAuthGuard) confirm(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConfirmInvoiceDto,
  ) {
    return this.invoices.confirm(id, req.user.sub, dto.reference);
  }
  @Post(':id/reject-transfer') @UseGuards(JwtAuthGuard) reject(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: RejectTransferDto,
  ) {
    return this.invoices.rejectReport(id, req.user.sub, dto.reportId, dto.note);
  }
  @Post(':id/cancel') @UseGuards(JwtAuthGuard) cancel(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.invoices.void(id, req.user.sub);
  }
}
@Controller('merchant-payments')
export class MerchantPaymentsController {
  constructor(private readonly invoices: GoodsInvoicesService) {}
  @Get('conversations/:id/invoice-buyer') @UseGuards(JwtAuthGuard) invoiceBuyer(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.invoices.invoiceBuyer(req.user.sub, id);
  }
  @Post('orders') @UseGuards(JwtAuthGuard) createOrder(
    @Req() req: AuthenticatedRequest,
    @Body() dto: MerchantOrderInvoiceDto,
  ) {
    return this.invoices.createMerchantOrder(req.user.sub, dto);
  }
  @Get() @UseGuards(JwtAuthGuard) status(@Req() req: AuthenticatedRequest) {
    return this.invoices.connectionStatus(req.user.sub);
  }
  @Post('connect') @UseGuards(JwtAuthGuard) connect(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConnectMerchantPaymentDto,
  ) {
    return this.invoices.connect(req.user.sub, dto.secretKey);
  }
  @Delete('connect') @UseGuards(JwtAuthGuard) disconnect(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.invoices.disconnect(req.user.sub);
  }
  @Get('products') @UseGuards(JwtAuthGuard) products(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.invoices.catalog(req.user.sub);
  }
  @Post('conversations/:id/invoice') @UseGuards(JwtAuthGuard) invoice(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ChatInvoiceDto,
  ) {
    return this.invoices.chatInvoice(req.user.sub, id, dto);
  }
  @Post('webhook/:vendorId') @HttpCode(200) webhook(
    @Param('vendorId') vendorId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string,
    @Body() event: { event?: string; data?: { reference?: string } },
  ) {
    return this.invoices.webhook(vendorId, req.rawBody, signature, event);
  }
}
