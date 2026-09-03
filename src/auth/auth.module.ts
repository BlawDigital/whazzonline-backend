import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp/otp.service';
import { MockOtpProvider } from './otp/mock-otp.provider';
import { OTP_PROVIDER } from './otp/otp.provider';
import { EMAIL_OTP_PROVIDER } from './otp/email-otp.provider';
import { MockEmailOtpProvider } from './otp/mock-email-otp.provider';
import { ResendEmailOtpProvider } from './otp/resend-email-otp.provider';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    MockOtpProvider,
    MockEmailOtpProvider,
    {
      provide: OTP_PROVIDER,
      useExisting: MockOtpProvider,
    },
    {
      provide: EMAIL_OTP_PROVIDER,
      inject: [ConfigService, MockEmailOtpProvider],
      useFactory: (
        config: ConfigService,
        mockProvider: MockEmailOtpProvider,
      ) => {
        const apiKey = config.get<string>('RESEND_API_KEY');
        const from = config.get<string>('EMAIL_FROM');
        return apiKey && from
          ? new ResendEmailOtpProvider(apiKey, from)
          : mockProvider;
      },
    },
  ],
  exports: [AuthService, OtpService],
})
export class AuthModule {}
