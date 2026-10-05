import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OtpProvider } from './otp.provider';

@Injectable()
export class MockOtpProvider implements OtpProvider {
  private readonly logger = new Logger(MockOtpProvider.name);

  private readonly pendingOtps = new Map<string, string>();

  async sendOtp(phone: string): Promise<{ pinId: string }> {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const pinId = randomUUID();

    this.pendingOtps.set(pinId, otp);

    this.logger.log(`[DEV OTP] ${phone} -> ${otp}`);

    return {
      pinId,
    };
  }

  async verifyOtp(pinId: string, code: string): Promise<boolean> {
    const expectedOtp = this.pendingOtps.get(pinId);

    if (!expectedOtp) {
      return false;
    }

    const isValid = expectedOtp === code;

    if (isValid) {
      this.pendingOtps.delete(pinId);
    }

    return isValid;
  }
}