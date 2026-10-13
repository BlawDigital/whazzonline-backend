import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/guards/authenticated-request';
import { CommerceService } from './commerce.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { CreateTrustReviewDto } from './dto/create-trust-review.dto';
import { ReportOrderIssueDto } from './dto/report-order-issue.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { GuestCheckoutDto } from './dto/guest-checkout.dto';

@Controller('buyer')
@UseGuards(JwtAuthGuard)
export class CommerceController {
  constructor(private readonly commerce: CommerceService) { }

  @Get('cart')
  load(@Req() request: AuthenticatedRequest) {
    return this.commerce.snapshot(request.user.sub);
  }

  @Post('cart')
  add(@Req() request: AuthenticatedRequest, @Body() dto: AddCartItemDto) {
    return this.commerce.addItem(request.user.sub, dto);
  }

  @Patch('cart/:id')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.commerce.updateQuantity(request.user.sub, id, dto.quantity);
  }

  @Delete('cart/:id')
  remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.commerce.removeItem(request.user.sub, id);
  }

  @Post('checkout')
  checkout(@Req() request: AuthenticatedRequest, @Body() dto: CheckoutDto) {
    return this.commerce.checkout(request.user.sub, dto);
  }

  @Get('product-likes')
  productLikes(@Req() request: AuthenticatedRequest) {
    return this.commerce.productLikes(request.user.sub);
  }

  @Post('products/:productId/like')
  likeProduct(
    @Req() request: AuthenticatedRequest,
    @Param('productId') productId: string,
  ) {
    return this.commerce.likeProduct(request.user.sub, productId);
  }

  @Delete('products/:productId/like')
  unlikeProduct(
    @Req() request: AuthenticatedRequest,
    @Param('productId') productId: string,
  ) {
    return this.commerce.unlikeProduct(request.user.sub, productId);
  }

  @Patch('orders/:id')
  updateOrder(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.commerce.completeOrder(request.user.sub, id);
  }

  @Post('order-issues')
  reportIssue(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ReportOrderIssueDto,
  ) {
    return this.commerce.reportIssue(request.user.sub, dto);
  }

  @Post('returns')
  createReturn(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateReturnDto,
  ) {
    return this.commerce.createReturn(request.user.sub, dto);
  }

  @Post('trust-reviews')
  createTrustReview(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateTrustReviewDto,
  ) {
    return this.commerce.createTrustReview(request.user.sub, dto);
  }
}