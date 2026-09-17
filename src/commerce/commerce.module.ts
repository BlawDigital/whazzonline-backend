import { Module } from '@nestjs/common';

import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { SellerOrdersController } from './seller-orders.controller';
import { SellerOrdersService } from './seller-orders.service';

@Module({
  controllers: [CommerceController, SellerOrdersController],
  providers: [CommerceService, SellerOrdersService],
})
export class CommerceModule {}
