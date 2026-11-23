import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { PrismaService } from 'prisma/prisma.service';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReferralRewardsService } from './referral-rewards.service';

export class UpdateReferralRulesDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  minOrderValue?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  rewardAmount?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  qualificationWindowDays?: number;
  @IsOptional() @IsBoolean() firstOrderOnly?: boolean;
}

export class ReverseOrderDto {
  @IsOptional() @IsString() @MaxLength(80) cause?: string;
}

/** Back-office endpoints for the referral reward engine. */
@Controller('referrals/admin')
@UseGuards(JwtAuthGuard)
export class ReferralAdminController {
  constructor(
    private readonly rewards: ReferralRewardsService,
    private readonly prisma: PrismaService,
  ) {}

  private async assertAdmin(request: AuthenticatedRequest) {
    const user = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { role: true, isActive: true },
    });
    if (!user?.isActive || user.role !== 'ADMIN')
      throw new ForbiddenException('Administrator access is required.');
  }

  @Get('rules')
  async rules(@Req() request: AuthenticatedRequest) {
    await this.assertAdmin(request);
    return this.rewards.rules();
  }

  @Patch('rules')
  async updateRules(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateReferralRulesDto,
  ) {
    await this.assertAdmin(request);
    return this.rewards.updateRules(dto);
  }

  /** Called when a refund or chargeback is confirmed for an order. */
  @Post('orders/:orderId/reverse')
  async reverse(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
    @Body() dto: ReverseOrderDto,
  ) {
    await this.assertAdmin(request);
    return (
      (await this.rewards.onOrderReversed(orderId, dto.cause ?? 'manual')) ?? {
        status: 'UNCHANGED',
      }
    );
  }

  @Get('audit')
  async audit(
    @Req() request: AuthenticatedRequest,
    @Query('referralId') referralId?: string,
    @Query('event') event?: string,
  ) {
    await this.assertAdmin(request);
    return this.prisma.referralAuditLog.findMany({
      where: {
        ...(referralId ? { referralId } : {}),
        ...(event ? { event } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
