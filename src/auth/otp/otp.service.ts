import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EmailOtpPurpose, PhoneOtpPurpose } from 'generated/prisma/enums';
import { PrismaService } from 'prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { OTP_PROVIDER, type OtpProvider } from './otp.provider';
import {
  EMAIL_OTP_PROVIDER,
  type EmailOtpProvider,
} from './email-otp.provider';

@Injectable()
export class OtpService {
  private readonly OTP_EXPIRY_MINUTES = 2;
  private readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
    @Inject(EMAIL_OTP_PROVIDER)
    private readonly emailOtpProvider: EmailOtpProvider,
  ) {}

  async sendPhoneOtp(phone: string, purpose: PhoneOtpPurpose = 'REGISTRATION') {
    const normalizedPhone = phone.trim();
    const existingOtp = await this.prisma.phoneOtp.findFirst({
      where: {
        phone: normalizedPhone,
        verified: false,
        purpose,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    if (existingOtp) {
      throw new BadRequestException(
        'A verification code has already been sent. Please wait before requesting another.',
      );
    }
    //Generate six-digit otp

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const codeHash = await bcrypt.hash(otp, 10);

    const expiresAt = new Date(
      Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000,
    );

    await this.prisma.phoneOtp.create({
      data: {
        phone: normalizedPhone,
        codeHash,
        expiresAt,
        attempts: 0,
        verified: false,
        purpose,
      },
    });

    await this.otpProvider.sendOtp(normalizedPhone, otp);

    return {
      message: 'Verification code sent.',
      expiresIn: this.OTP_EXPIRY_MINUTES * 60,
    };
  }

  async verifyPhoneOtp(
    phone: string,
    code: string,
    purpose: PhoneOtpPurpose = 'REGISTRATION',
  ) {
    const normalizedPhone = phone.trim();

    const otpRecord = await this.prisma.phoneOtp.findFirst({
      where: {
        phone: normalizedPhone,
        verified: false,
        purpose,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    if (!otpRecord) {
      throw new BadRequestException('No verification code found.');
    }

    if (otpRecord.expiresAt < new Date()) {
      throw new BadRequestException(
        'Verification code has expired. Please request a new code.',
      );
    }
    if (otpRecord.attempts >= this.MAX_ATTEMPTS) {
      throw new BadRequestException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }
    const isValid = await bcrypt.compare(code, otpRecord.codeHash);
    if (!isValid) {
      await this.prisma.phoneOtp.update({
        where: {
          id: otpRecord.id,
        },
        data: {
          attempts: {
            increment: 1,
          },
        },
      });
      throw new BadRequestException('The verification code is incorrect.');
    }

    await this.prisma.phoneOtp.update({
      where: {
        id: otpRecord.id,
      },
      data: {
        verified: true,
      },
    });

    return {
      message: 'Phone number verified successfully.',
      verified: true,
    };
  }

  async sendEmailOtp(email: string, purpose: EmailOtpPurpose, userId?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existingOtp = await this.prisma.emailOtp.findFirst({
      where: {
        email: normalizedEmail,
        purpose,
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingOtp) {
      throw new BadRequestException(
        'A verification code has already been sent. Please wait before requesting another.',
      );
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(
      Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000,
    );
    await this.prisma.emailOtp.create({
      data: { codeHash, email: normalizedEmail, expiresAt, purpose, userId },
    });
    await this.emailOtpProvider.sendOtp(
      normalizedEmail,
      otp,
      purpose === 'REGISTRATION'
        ? 'registration'
        : purpose === 'EMAIL_CHANGE'
          ? 'email change'
          : 'password reset',
    );
    return {
      message: 'Verification code sent.',
      expiresIn: this.OTP_EXPIRY_MINUTES * 60,
    };
  }

  async verifyEmailOtp(
    email: string,
    code: string,
    purpose: EmailOtpPurpose,
    userId?: string,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const otpRecord = await this.prisma.emailOtp.findFirst({
      where: {
        email: normalizedEmail,
        purpose,
        ...(userId ? { userId } : {}),
        verified: false,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otpRecord)
      throw new BadRequestException('No verification code found.');
    if (otpRecord.expiresAt < new Date()) {
      throw new BadRequestException(
        'Verification code has expired. Please request a new code.',
      );
    }
    if (otpRecord.attempts >= this.MAX_ATTEMPTS) {
      throw new BadRequestException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }
    if (!(await bcrypt.compare(code, otpRecord.codeHash))) {
      await this.prisma.emailOtp.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('The verification code is incorrect.');
    }
    await this.prisma.emailOtp.update({
      where: { id: otpRecord.id },
      data: { verified: true },
    });
    return otpRecord.id;
  }

  async consumeVerifiedEmailOtp(
    email: string,
    code: string,
    purpose: EmailOtpPurpose,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const otpRecord = await this.prisma.emailOtp.findFirst({
      where: {
        email: normalizedEmail,
        purpose,
        verified: true,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otpRecord || !(await bcrypt.compare(code, otpRecord.codeHash))) {
      throw new BadRequestException(
        'Verify a valid code before updating your password.',
      );
    }
    await this.prisma.emailOtp.update({
      where: { id: otpRecord.id },
      data: { consumedAt: new Date() },
    });
  }
}
