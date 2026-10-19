import { Module } from '@nestjs/common';

import {
  AdminSupportController,
  PublicSupportController,
  SellerSupportController,
} from './support.controller';
import { SupportService } from './support.service';

@Module({
  controllers: [
    SellerSupportController,
    AdminSupportController,
    PublicSupportController,
  ],
  providers: [SupportService],
})
export class SupportModule {}
