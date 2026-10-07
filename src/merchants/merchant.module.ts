import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import {
  MerchantController,
  MerchantPublicController,
} from './merchant.controller';
import { MerchantService } from './merchant.service';
@Module({
  imports: [PrismaModule],
  controllers: [MerchantController, MerchantPublicController],
  providers: [MerchantService],
})
export class MerchantModule {}
