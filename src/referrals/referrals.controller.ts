import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReferralsService, referralRules } from './referrals.service';
import { ReferralQueryDto } from './referral-query.dto';

@Controller('users/:userId/referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('rules')
  rules(@Req() request: AuthenticatedRequest, @Param('userId') userId: string) {
    this.assertOwner(request, userId);
    return referralRules;
  }

  @Get('status')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query() query: ReferralQueryDto,
  ) {
    this.assertOwner(request, userId);
    return this.referralsService.list(userId, query);
  }

  @Get('reward-history')
  rewards(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query() query: ReferralQueryDto,
  ) {
    this.assertOwner(request, userId);
    return this.referralsService.rewards(userId, query);
  }

  @Get()
  overview(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Query('compact') compact?: string,
  ) {
    this.assertOwner(request, userId);
    return this.referralsService.overview(userId, compact === 'true');
  }

  @Get('details/:referralId')
  detail(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('referralId') referralId: string,
  ) {
    this.assertOwner(request, userId);
    return this.referralsService.detail(userId, referralId);
  }

  @Get('rewards')
  rewardHistory(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    this.assertOwner(request, userId);
    return this.referralsService.rewardHistory(userId);
  }

  private assertOwner(request: AuthenticatedRequest, userId: string) {
    if (request.user.sub !== userId)
      throw new ForbiddenException('You can only view your own referrals.');
  }
}
