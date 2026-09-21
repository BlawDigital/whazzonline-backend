import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReferralsService } from './referrals.service';

@Controller('users/:userId/referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get()
  overview(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    this.assertOwner(request, userId);
    return this.referralsService.overview(userId);
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
