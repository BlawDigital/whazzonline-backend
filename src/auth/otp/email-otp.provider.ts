export const EMAIL_OTP_PROVIDER = 'EMAIL_OTP_PROVIDER';

export interface EmailOtpProvider {
  sendOtp(email: string, otp: string, purpose: 'email change' | 'password reset'): Promise<void>;
}
