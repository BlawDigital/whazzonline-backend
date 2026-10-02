import { Module } from '@nestjs/common';

import {
  AdminSupportController,
  SellerSupportController,
} from './support.controller';
import { SupportService } from './support.service';

@Module({
  controllers: [SellerSupportController, AdminSupportController],
  providers: [SupportService],
})
export class SupportModule {}
