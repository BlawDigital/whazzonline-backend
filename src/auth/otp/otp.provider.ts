export const OTP_PROVIDER = 'OTP_PROVIDER';

export interface OtpProvider {
  sendOtp(phone: string): Promise<{pinId: string}>;
  verifyOtp(pinId: string, code: string): Promise<boolean>;
}
