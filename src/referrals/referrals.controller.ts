import { Controller, Get, Param } from '@nestjs/common';
import { ReferralsService } from './referrals.service';

@Controller('users/:userId/referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get()
  overview(@Param('userId') userId: string) {
    return this.referralsService.overview(userId);
  }

  @Get('rewards')
  rewardHistory(@Param('userId') userId: string) {
    return this.referralsService.rewardHistory(userId);
  }
}
