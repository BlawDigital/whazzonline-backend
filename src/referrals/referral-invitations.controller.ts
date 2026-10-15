import { Controller, Get, Param } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
@Controller('referrals/invitations')
export class ReferralInvitationsController {
  constructor(private readonly referrals: ReferralsService) {}
  @Get(':code') resolve(@Param('code') code: string) {
    return this.referrals.resolve(code);
  }
}
