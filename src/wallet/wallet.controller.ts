import { Controller, Get, Param } from '@nestjs/common';
import { WalletService } from './wallet.service';

@Controller('users/:userId/wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  summary(@Param('userId') userId: string) {
    return this.walletService.summary(userId);
  }

  @Get('transactions')
  transactions(@Param('userId') userId: string) {
    return this.walletService.transactions(userId);
  }
}
