import { Controller, Get } from '@nestjs/common';

import { MarketplaceService } from './marketplace.service';

@Controller('buyer/marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get()
  list() {
    return this.marketplaceService.list();
  }
}
