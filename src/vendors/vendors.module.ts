import { Module } from '@nestjs/common';

import { VendorsController } from './vendors.controller';
import { StoreCommunityService } from './store-community.service';
import { VendorsService } from './vendors.service';

@Module({
  controllers: [VendorsController],
  providers: [VendorsService, StoreCommunityService],
})
export class VendorsModule {}
