import {
  Controller,
  Get,
  Post,
  Req,
  Param,
  UseGuards,
  Headers,
  HttpCode,
  Body,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import { MerchantBillingService } from './merchant-billing.service';
@Controller('merchant-subscription')
@UseGuards(JwtAuthGuard)
export class MerchantBillingController {
  constructor(private readonly billing: MerchantBillingService) {}
  @Get() summary(@Req() request: AuthenticatedRequest) {
    return this.billing.summary(request.user.sub);
  }
  @Post('checkout') checkout(@Req() request: AuthenticatedRequest) {
    return this.billing.checkout(request.user.sub);
  }
  @Post('verify/:reference') verify(
    @Req() request: AuthenticatedRequest,
    @Param('reference') reference: string,
  ) {
    return this.billing.verify(request.user.sub, reference);
  }
}
@Controller('payments/paystack')
export class ReferralPaymentWebhookController {
  constructor(private readonly billing: MerchantBillingService) {}
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string,
    @Body() event: { event?: string; data?: { reference?: string } },
  ) {
    return this.billing.webhook(request.rawBody, signature, event);
  }
}
