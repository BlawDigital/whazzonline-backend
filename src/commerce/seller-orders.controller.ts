import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import {
  CreateSellerDisputeDto,
  DeliveryRequestDto,
  RejectSellerOrderDto,
  UpdateSellerOrderDto,
} from './dto/seller-order.dto';
import {
  disputeUploadOptions,
  publicDisputeUrl,
} from './dispute-upload.config';
import { SellerOrdersService } from './seller-orders.service';

@Controller('seller')
@UseGuards(JwtAuthGuard)
export class SellerOrdersController {
  constructor(private readonly orders: SellerOrdersService) {}
  @Get('capabilities') capabilities() {
    return this.orders.capabilities();
  }
  @Get('orders') list(@Req() req: AuthenticatedRequest) {
    return this.orders.list(req.user.sub);
  }
  @Get('orders/:id') detail(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.orders.detail(req.user.sub, id);
  }
  @Post('orders/:id/accept') accept(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.orders.transition(req.user.sub, id, 'processing');
  }
  @Post('orders/:id/reject') reject(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RejectSellerOrderDto,
  ) {
    return this.orders.transition(req.user.sub, id, 'rejected', dto.reason);
  }
  @Patch('orders/:id/status') status(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateSellerOrderDto,
  ) {
    return this.orders.transition(req.user.sub, id, dto.status);
  }
  @Get('orders/:id/delivery') delivery(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.orders.delivery(req.user.sub, id);
  }
  @Post('orders/:id/delivery-requests') requestDelivery(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: DeliveryRequestDto,
  ) {
    return this.orders.requestDelivery(req.user.sub, id, dto.serviceLevel);
  }
  @Post('orders/:id/conversation') customerConversation(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.orders.customerConversation(req.user.sub, id);
  }
  @Post('orders/:id/disputes')
  @UseInterceptors(FilesInterceptor('evidence', 5, disputeUploadOptions))
  dispute(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CreateSellerDisputeDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.orders.createDispute(
      req.user.sub,
      id,
      dto.reason,
      dto.description,
      files.map(publicDisputeUrl),
    );
  }
}
