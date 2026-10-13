
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CommerceService } from './commerce.service';
import { GuestCheckoutDto } from './dto/guest-checkout.dto';

@Controller('buyer')
export class GuestCheckoutController {
  constructor(private readonly commerce: CommerceService) { }

  @Post('guest-checkout')
  guestCheckout(@Body() dto: GuestCheckoutDto) {
    return this.commerce.guestCheckout(dto);
  }
  
  @Get('payment/verify/:reference')
  verifyPayment(@Param('reference') reference: string) {
    return this.commerce.verifyPaystackPayment(reference);
  }


}