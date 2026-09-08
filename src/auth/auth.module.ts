import "dotenv/config";
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OtpService } from "./otp/otp.service";
import { MockOtpProvider } from "./otp/mock-otp.provider";
import { OTP_PROVIDER } from "./otp/otp.provider";

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: "7d",
      },
    }),
  ],

  controllers: [AuthController],

  providers: [
    AuthService,
    OtpService,
    MockOtpProvider,
    {
      provide: OTP_PROVIDER,
      useExisting: MockOtpProvider,
    },
  ],

  exports: [
    AuthService,
    OtpService,
  ],
})
export class AuthModule {}