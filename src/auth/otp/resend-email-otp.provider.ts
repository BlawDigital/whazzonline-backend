import { BadRequestException, Injectable } from '@nestjs/common';

import type { EmailOtpProvider } from './email-otp.provider';

@Injectable()
export class ResendEmailOtpProvider implements EmailOtpProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendOtp(
    email: string,
    otp: string,
    purpose: 'email change' | 'password reset',
  ): Promise<void> {
    const subject =
      purpose === 'email change'
        ? 'Confirm your new Whazzonline email'
        : 'Reset your Whazzonline password';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        html: `<p>Your Whazzonline ${purpose} code is:</p><h1>${otp}</h1><p>This code expires in 2 minutes.</p>`,
        subject,
        to: [email],
      }),
    });
    if (!response.ok) {
      throw new BadRequestException(
        'We could not send the verification email.',
      );
    }
  }
}
