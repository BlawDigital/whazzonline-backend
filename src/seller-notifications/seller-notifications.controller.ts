import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import { SellerNotificationsService } from './seller-notifications.service';
import {
  NotificationSettingsDto,
  ReadNotificationsDto,
} from './dto/notification.dto';
@Controller('seller/notifications')
@UseGuards(JwtAuthGuard)
export class SellerNotificationsController {
  constructor(private readonly service: SellerNotificationsService) {}
  @Get() list(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
  ) {
    return this.service.list(req.user.sub, search, type, Number(page) || 1);
  }
  @Get('settings') settings(@Req() req: AuthenticatedRequest) {
    return this.service.settings(req.user.sub);
  }
  @Patch('settings') saveSettings(
    @Req() req: AuthenticatedRequest,
    @Body() dto: NotificationSettingsDto,
  ) {
    return this.service.saveSettings(req.user.sub, dto);
  }

  //Adjustment to push 
  @Patch('read') read(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ReadNotificationsDto,
  ) {
    return this.service.markRead(req.user.sub, dto.ids);
  }
  @Post('read-all') readAll(@Req() req: AuthenticatedRequest) {
    return this.service.markRead(req.user.sub);
  }
}
