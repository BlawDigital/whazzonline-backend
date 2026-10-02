import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SendPhoneOtpDto } from './dto/send-otp.dto';
import { VerifyPhoneOtpDto } from './dto/verify-otp';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { EmailOtpRequestDto, EmailOtpVerifyDto } from './dto/email-otp.dto';
import {
  PasswordResetRequestDto,
  PasswordResetUpdateDto,
  PasswordResetVerifyDto,
} from './dto/password-reset.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedRequest } from './guards/authenticated-request';
import { UpdateProfileDto } from './dto/update-profile';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getCurrentUser(@Req() request: AuthenticatedRequest) {
    return this.authService.getCurrentUser(request.user.sub);
  }

  // ============================================================
  // PHONE OTP
  // ============================================================

  @Post('phone/send-otp')
  async sendPhoneOtp(@Body() dto: SendPhoneOtpDto) {
    return this.authService.sendPhoneOtp(dto.phone);
  }

  @Post('phone/verify-otp')
  async verifyPhoneOtp(@Body() dto: VerifyPhoneOtpDto) {
    return this.authService.verifyPhoneOtp(dto.phone, dto.code);
  }

  @Post('email/send-otp')
  sendEmailRegistrationOtp(@Body() dto: EmailOtpRequestDto) {
    return this.authService.sendEmailRegistrationOtp(dto.email);
  }

  @Post('email/verify-otp')
  verifyEmailRegistrationOtp(@Body() dto: EmailOtpVerifyDto) {
    return this.authService.verifyEmailRegistrationOtp(dto.email, dto.code);
  }

  // ============================================================
  // REGISTRATION
  // ============================================================

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // ============================================================
  // LOGIN
  // ============================================================

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('users/:userId/email/request-change')
  requestEmailChange(
    @Param('userId') userId: string,
    @Body() dto: EmailOtpRequestDto,
  ) {
    return this.authService.requestEmailChange(userId, dto.email);
  }

  @Post('users/:userId/email/confirm-change')
  confirmEmailChange(
    @Param('userId') userId: string,
    @Body() dto: EmailOtpVerifyDto,
  ) {
    return this.authService.confirmEmailChange(userId, dto.email, dto.code);
  }

  @Post('users/:userId/phone/request-change')
  requestPhoneChange(
    @Param('userId') userId: string,
    @Body() dto: SendPhoneOtpDto,
  ) {
    return this.authService.requestPhoneChange(userId, dto.phone);
  }

  @Post('users/:userId/phone/confirm-change')
  confirmPhoneChange(
    @Param('userId') userId: string,
    @Body() dto: VerifyPhoneOtpDto,
  ) {
    return this.authService.confirmPhoneChange(userId, dto.phone, dto.code);
  }

  @Post('password-reset/request')
  requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Post('password-reset/verify')
  verifyPasswordReset(@Body() dto: PasswordResetVerifyDto) {
    return this.authService.verifyPasswordReset(dto.email, dto.code);
  }

  @Post('password-reset/update')
  resetPassword(@Body() dto: PasswordResetUpdateDto) {
    return this.authService.resetPassword(dto.email, dto.code, dto.password);
  }

  @Patch("me/profile")
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(
      request.user.sub,
      dto,
    );
  }
}

