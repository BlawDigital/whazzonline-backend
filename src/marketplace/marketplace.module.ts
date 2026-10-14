import { Module } from '@nestjs/common';

import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { ProductsController } from './products.controller';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports:[AuthModule],
  controllers: [MarketplaceController, ProductsController],
  providers: [MarketplaceService],
})
export class MarketplaceModule {}
