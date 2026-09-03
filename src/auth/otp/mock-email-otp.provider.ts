import { Injectable, Logger } from '@nestjs/common';

import type { EmailOtpProvider } from './email-otp.provider';

@Injectable()
export class MockEmailOtpProvider implements EmailOtpProvider {
  private readonly logger = new Logger(MockEmailOtpProvider.name);

  async sendOtp(
    email: string,
    otp: string,
    purpose: 'email change' | 'password reset',
  ): Promise<void> {
    this.logger.log(`[DEV EMAIL OTP] ${purpose} ${email} -> ${otp}`);
  }
}
