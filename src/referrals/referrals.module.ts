import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { ReferralInvitationsController } from './referral-invitations.controller';
import { MerchantBillingService } from './merchant-billing.service';
import { ReferralRewardsService } from './referral-rewards.service';
import { ReferralAdminController } from './referral-admin.controller';
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
    ReferralAdminController,
  ],
  providers: [ReferralsService, MerchantBillingService, ReferralRewardsService],
  exports: [ReferralRewardsService],
})
export class ReferralsModule {}
