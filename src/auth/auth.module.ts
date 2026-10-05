import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp/otp.service';
import { MockOtpProvider } from './otp/mock-otp.provider';
import { OTP_PROVIDER } from './otp/otp.provider';
import { EMAIL_OTP_PROVIDER } from './otp/email-otp.provider';
import { MockEmailOtpProvider } from './otp/mock-email-otp.provider';
import { ResendEmailOtpProvider } from './otp/resend-email-otp.provider';
import { TermiiOtpProvider } from './otp/termii-otp.provider';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET')?.trim();
        if (!secret) {
          throw new Error(
            'JWT_SECRET is required. Configure it in the environment before starting the server.',
          );
        }
        if (secret.length < 32) {
          throw new Error('JWT_SECRET must contain at least 32 characters.');
        }

        return {
          secret,
          signOptions: { expiresIn: '7d' },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TermiiOtpProvider,
    MockEmailOtpProvider,
    {
      provide: OTP_PROVIDER,
      useExisting: TermiiOtpProvider,
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
