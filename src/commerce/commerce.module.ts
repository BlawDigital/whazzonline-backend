import { GoodsInvoicesModule } from '../invoices/goods-invoices.module';
import { Module } from '@nestjs/common';
import { ReferralsModule } from '../referrals/referrals.module';

import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { SellerOrdersController } from './seller-orders.controller';
import { SellerOrdersService } from './seller-orders.service';
import { DeliveryProvider, MockDeliveryProvider } from './delivery.provider';
import { GuestCheckoutController } from './guest-checkout.controller';

@Module({
  imports: [GoodsInvoicesModule, ReferralsModule],
  exports: [SellerOrdersService],
  controllers: [
    CommerceController,
    SellerOrdersController,
    GuestCheckoutController,
  ],
  providers: [
    CommerceService,
    SellerOrdersService,
    { provide: DeliveryProvider, useClass: MockDeliveryProvider },
  ],
})
export class CommerceModule {}
