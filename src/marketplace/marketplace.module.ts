import { Module } from '@nestjs/common';

import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { ProductsController } from './products.controller';

@Module({
  controllers: [MarketplaceController, ProductsController],
  providers: [MarketplaceService],
})
export class MarketplaceModule {}
