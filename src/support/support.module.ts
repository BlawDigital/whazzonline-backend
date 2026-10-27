import { Module } from '@nestjs/common';

import {
  AdminSupportController,
  PublicSupportController,
  SellerSupportController,
  UserSupportController,
} from './support.controller';
import { SupportService } from './support.service';

@Module({
  controllers: [
    SellerSupportController,
    AdminSupportController,
    PublicSupportController,
    UserSupportController,
  ],
  providers: [SupportService],
})
export class SupportModule {}
