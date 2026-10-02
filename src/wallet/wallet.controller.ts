import { Controller, ForbiddenException, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';

@Controller('users/:userId/wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  private assertOwner(request: AuthenticatedRequest, userId: string) {
    if (request.user.sub !== userId) throw new ForbiddenException('You can only view your own wallet.');
  }

  @Get()
  summary(@Req() request: AuthenticatedRequest, @Param('userId') userId: string) {
    this.assertOwner(request, userId);
    return this.walletService.summary(userId);
  }

  @Get('transactions')
  transactions(@Req() request: AuthenticatedRequest, @Param('userId') userId: string) {
    this.assertOwner(request, userId);
    return this.walletService.transactions(userId);
  }
}
