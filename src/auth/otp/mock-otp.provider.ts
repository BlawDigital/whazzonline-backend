import { Injectable, Logger } from '@nestjs/common';
import { OtpProvider } from './otp.provider';

@Injectable()
export class MockOtpProvider implements OtpProvider {
  private readonly logger = new Logger(MockOtpProvider.name);
  async sendOtp(phone: string, otp: string): Promise<void> {
    this.logger.log(`[DEV OTP] ${phone} -> ${otp}`);
  }
}
