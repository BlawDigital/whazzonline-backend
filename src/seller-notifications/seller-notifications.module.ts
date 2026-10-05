import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { SellerNotificationsController } from './seller-notifications.controller';
import { SellerNotificationsService } from './seller-notifications.service';
@Module({
  imports: [CommerceModule],
  controllers: [SellerNotificationsController],
  providers: [SellerNotificationsService],
})
export class SellerNotificationsModule {}
