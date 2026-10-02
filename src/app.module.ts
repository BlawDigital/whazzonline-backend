import { SellerNotificationsModule } from './seller-notifications/seller-notifications.module';
import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from 'prisma/prisma.module';
import { VendorsModule } from './vendors/vendors.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { WalletModule } from './wallet/wallet.module';
import { ReferralsModule } from './referrals/referrals.module';
import { CommerceModule } from './commerce/commerce.module';
import { MessagingModule } from './messaging/messaging.module';
import { IneterestsModule } from './interests/interests.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    VendorsModule,
    MarketplaceModule,
    WalletModule,
    ReferralsModule,
    CommerceModule,
    MessagingModule,
    IneterestsModule,
    SupportModule,
    SellerNotificationsModule,
  ],
})
export class AppModule {}
