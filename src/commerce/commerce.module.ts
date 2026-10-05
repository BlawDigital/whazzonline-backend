import { Module } from '@nestjs/common';

import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { SellerOrdersController } from './seller-orders.controller';
import { SellerOrdersService } from './seller-orders.service';
import { DeliveryProvider, MockDeliveryProvider } from './delivery.provider';

@Module({
  exports: [SellerOrdersService],
  controllers: [CommerceController, SellerOrdersController],
  providers: [
    CommerceService,
    SellerOrdersService,
    { provide: DeliveryProvider, useClass: MockDeliveryProvider },
  ],
})
export class CommerceModule {}
