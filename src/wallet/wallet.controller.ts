import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  WalletChallengeDto,
  WalletPaymentDto,
  WalletPinDto,
} from './wallet.dto';
import { GoodsInvoicesService } from '../invoices/goods-invoices.service';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';

@Controller('users/:userId/wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly invoices: GoodsInvoicesService,
  ) {}

  private assertOwner(request: AuthenticatedRequest, userId: string) {
    if (request.user.sub !== userId)
      throw new ForbiddenException('You can only view your own wallet.');
  }

  @Post('pin/challenge') challenge(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: WalletChallengeDto,
  ) {
    this.assertOwner(req, userId);
    return this.walletService.requestPin(userId, dto.channel);
  }
  @Post('pin') pin(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() dto: WalletPinDto,
  ) {
    this.assertOwner(req, userId);
    return this.walletService.setPin(userId, dto);
  }
  @Post('orders/:orderId/pay') pay(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('orderId') orderId: string,
    @Body() dto: WalletPaymentDto,
  ) {
    this.assertOwner(req, userId);
    return this.invoices.payWallet(userId, orderId, dto);
  }
  @Get('orders/:orderId') order(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('orderId') orderId: string,
  ) {
    this.assertOwner(req, userId);
    return this.invoices.walletOrder(userId, orderId);
  }

  @Get()
  summary(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    this.assertOwner(request, userId);
    return this.walletService.summary(userId);
  }

  @Get('transactions')
  transactions(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    this.assertOwner(request, userId);
    return this.walletService.transactions(userId);
  }
}
