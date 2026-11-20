import { Module } from '@nestjs/common';

import { VendorsController } from './vendors.controller';
import { SharingController } from '../sharing/sharing.controller';
import { StoreCommunityService } from './store-community.service';
import { VendorsService } from './vendors.service';

@Module({
  controllers: [VendorsController, SharingController],
  providers: [VendorsService, StoreCommunityService],
})
export class VendorsModule {}
