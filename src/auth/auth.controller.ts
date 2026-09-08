import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { SendPhoneOtpDto } from "./dto/send-otp.dto";
import { VerifyPhoneOtpDto } from "./dto/verify-otp";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import type { AuthenticatedRequest } from "./guards/authenticated-request";

@Controller("auth")
export class AuthController {
    constructor(private readonly authService: AuthService,) { }

    // ============================================================
    // PHONE OTP
    // ============================================================
    @Get("me")
    @UseGuards(JwtAuthGuard)
    async getCurrentUser(@Req() request: AuthenticatedRequest,) {

        return this.authService.getCurrentUser(request.user.sub,);
    }
    @Post("phone/send-otp")
    async sendPhoneOtp(@Body() dto: SendPhoneOtpDto,) {
        return this.authService.sendPhoneOtp(dto.phone,);
    }

    @Post("phone/verify-otp")
    async verifyPhoneOtp(@Body() dto: VerifyPhoneOtpDto,) {
        return this.authService.verifyPhoneOtp(dto.phone, dto.code,);
    }

    // ============================================================
    // REGISTRATION
    // ============================================================

    @Post("register")
    async register(@Body() dto: RegisterDto,) {
        return this.authService.register(dto);
    }

    // ============================================================
    // LOGIN
    // ============================================================

    @Post("login")
    async login(@Body() dto: LoginDto,) {
        return this.authService.login(dto);
    }
}