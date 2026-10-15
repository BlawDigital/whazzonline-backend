import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { ReferralInvitationsController } from './referral-invitations.controller';
import { MerchantBillingService } from './merchant-billing.service';
import {
  MerchantBillingController,
  ReferralPaymentWebhookController,
} from './merchant-billing.controller';
@Module({
  controllers: [
    ReferralsController,
    ReferralInvitationsController,
    MerchantBillingController,
    ReferralPaymentWebhookController,
  ],
  providers: [ReferralsService, MerchantBillingService],
})
export class ReferralsModule {}
