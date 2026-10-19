import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { OtpService } from './otp/otp.service';
import { PrismaService } from 'prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { normalizePhone, phoneLookupCandidates } from './phone/normalize-phone';
import { UpdateProfileDto } from './dto/update-profile';
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly jwtService: JwtService,
  ) {}

  private generateToken(user: {
    id: string;
    phone: string | null;
    email: string | null;
  }) {
    return this.jwtService.signAsync({
      sub: user.id,
      phone: user.phone,
      email: user.email,
    });
  }

  // ============================================================
  // PHONE OTP
  // ============================================================

  async sendPhoneOtp(phone: string) {
    return this.otpService.sendPhoneOtp(phone);
  }

  async verifyPhoneOtp(phone: string, code: string) {
    const normalizedPhone = normalizePhone(phone);
    const verification = await this.otpService.verifyPhoneOtp(
      normalizedPhone,
      code,
    );
    const user = await this.prisma.user.findFirst({
      where: { phone: { in: phoneLookupCandidates(normalizedPhone) } },
      include: {
        vendorProfile: { select: { setupCompleted: true, storeName: true } },
      },
    });

    const publicUser = user ? this.toPublicUser(user) : null;
    const accessToken = user ? await this.generateToken(user) : null;

    return {
      ...verification,
      accessToken,
      user: publicUser,
    };
  }

  async sendEmailRegistrationOtp(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }
    return this.otpService.sendEmailOtp(normalizedEmail, 'REGISTRATION');
  }

  async verifyEmailRegistrationOtp(email: string, code: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }
    await this.otpService.verifyEmailOtp(normalizedEmail, code, 'REGISTRATION');
    return { message: 'Email verified successfully.', verified: true };
  }

  async requestEmailChange(userId: string, email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    if (user.email?.toLowerCase() === normalizedEmail) {
      throw new ConflictException('This is already the email on your account.');
    }
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing)
      throw new ConflictException('An account with this email already exists.');
    return this.otpService.sendEmailOtp(
      normalizedEmail,
      'EMAIL_CHANGE',
      userId,
    );
  }

  async confirmEmailChange(userId: string, email: string, code: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException('An account with this email already exists.');
    }
    const otpId = await this.otpService.verifyEmailOtp(
      normalizedEmail,
      code,
      'EMAIL_CHANGE',
      userId,
    );
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { email: normalizedEmail },
      include: {
        vendorProfile: { select: { setupCompleted: true, storeName: true } },
      },
    });
    await this.prisma.emailOtp.update({
      where: { id: otpId },
      data: { consumedAt: new Date() },
    });
    return this.toPublicUser(user);
  }

  async requestPhoneChange(userId: string, phone: string) {
    const normalizedPhone = normalizePhone(phone);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    if (user.phone === normalizedPhone) {
      throw new ConflictException(
        'This is already the phone number on your account.',
      );
    }
    const existing = await this.prisma.user.findFirst({
      where: { phone: { in: phoneLookupCandidates(normalizedPhone) } },
    });
    if (existing)
      throw new ConflictException(
        'An account with this phone number already exists.',
      );
    return this.otpService.sendPhoneOtp(normalizedPhone, 'PHONE_CHANGE');
  }

  async confirmPhoneChange(userId: string, phone: string, code: string) {
    const normalizedPhone = normalizePhone(phone);
    const existing = await this.prisma.user.findFirst({
      where: { phone: { in: phoneLookupCandidates(normalizedPhone) } },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException(
        'An account with this phone number already exists.',
      );
    }
    await this.otpService.verifyPhoneOtp(normalizedPhone, code, 'PHONE_CHANGE');
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { phone: normalizedPhone },
      include: {
        vendorProfile: { select: { setupCompleted: true, storeName: true } },
      },
    });
    await this.prisma.phoneOtp.updateMany({
      where: {
        phone: normalizedPhone,
        purpose: 'PHONE_CHANGE',
        verified: true,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });
    return this.toPublicUser(user);
  }

  private async passwordResetAccount(email?: string, phone?: string) {
    if (Boolean(email?.trim()) === Boolean(phone?.trim())) {
      throw new BadRequestException(
        'Enter either your email address or phone number.',
      );
    }
    const contact = phone ? normalizePhone(phone) : email!.trim().toLowerCase();
    const user = phone
      ? await this.prisma.user.findFirst({
          where: { phone: { in: phoneLookupCandidates(contact) } },
        })
      : await this.prisma.user.findUnique({ where: { email: contact } });
    return { contact, user: user?.isActive === false ? null : user };
  }

  async requestPasswordReset(email?: string, phone?: string) {
    const { contact, user } = await this.passwordResetAccount(email, phone);
    if (user) {
      if (phone) await this.otpService.sendPhoneOtp(contact, 'PASSWORD_RESET');
      else
        await this.otpService.sendEmailOtp(contact, 'PASSWORD_RESET', user.id);
    }
    return {
      message:
        'If these details are linked to an account, a reset code has been sent.',
    };
  }

  async verifyPasswordReset(
    email: string | undefined,
    code: string,
    phone?: string,
  ) {
    const { contact, user } = await this.passwordResetAccount(email, phone);
    if (!user)
      throw new BadRequestException(
        'The reset code is invalid or has expired.',
      );
    if (phone)
      await this.otpService.verifyPhoneOtp(contact, code, 'PASSWORD_RESET');
    else
      await this.otpService.verifyEmailOtp(
        contact,
        code,
        'PASSWORD_RESET',
        user.id,
      );
    return { verified: true };
  }

  async resetPassword(
    email: string | undefined,
    code: string,
    password: string,
    phone?: string,
  ) {
    const { contact, user } = await this.passwordResetAccount(email, phone);
    if (!user)
      throw new BadRequestException(
        'The reset code is invalid or has expired.',
      );
    if (phone) await this.otpService.consumeVerifiedPhoneReset(contact, code);
    else
      await this.otpService.consumeVerifiedEmailOtp(
        contact,
        code,
        'PASSWORD_RESET',
      );
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 12) },
    });
    return { message: 'Password updated successfully.' };
  }

  // ============================================================
  // REGISTER
  // ============================================================
  // ============================================================
  // REGISTER
  // ============================================================

  async register(registerDto: RegisterDto) {
    const { phone, firstName, lastName, email, registrationType, password } =
      registerDto;

    const normalizedPhone = phone ? normalizePhone(phone) : undefined;
    const normalizedEmail = email?.trim().toLowerCase();

    // At least one contact method is required
    if (!normalizedPhone && !normalizedEmail) {
      throw new ConflictException('Email or phone number is required.');
    }

    // Email registration requires a password
    // if (normalizedEmail && !password) {
    //   throw new ConflictException(
    //     'A password is required for email sign-up.',
    //   );
    // }

    // All new accounts require a password for future sign-in.
    if (!password) {
      throw new BadRequestException(
        'A password is required to create an account.',
      );
    }
    // ============================================================
    // CHECK PHONE
    // ============================================================

    if (normalizedPhone) {
      const existingPhone = await this.prisma.user.findFirst({
        where: {
          phone: {
            in: phoneLookupCandidates(normalizedPhone),
          },
        },
      });

      if (existingPhone) {
        throw new ConflictException(
          'An account with this phone number already exists.',
        );
      }
    }

    // ============================================================
    // CHECK EMAIL
    // ============================================================

    if (normalizedEmail) {
      const existingEmail = await this.prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });

      if (existingEmail) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
    }

    // ============================================================
    // HASH PASSWORD
    // ============================================================

    const passwordHash = password ? await bcrypt.hash(password, 12) : null;

    // ============================================================
    // DETERMINE ROLE
    // ============================================================

    const roleByRegistrationType = {
      BUYER: 'CUSTOMER',
      SELLER: 'VENDOR',
      BUSINESS: 'BUSINESS',
    } as const;

    const role = roleByRegistrationType[registrationType];
    const referrer = registerDto.referralCode
      ? await this.prisma.user.findFirst({
          where: {
            referralCode: registerDto.referralCode,
            isActive: true,
            isVerified: true,
          },
        })
      : null;
    if (registerDto.referralCode && !referrer)
      throw new BadRequestException(
        'This referral link is invalid or no longer active.',
      );
    if (registerDto.referralCode && registrationType === 'BUYER')
      throw new BadRequestException(
        'This invitation is for a merchant account. Choose Seller or Business to continue.',
      );

    // ============================================================
    // CREATE ACCOUNT
    // ============================================================

    const user = await this.prisma.user.create({
      data: {
        phone: normalizedPhone,
        firstName,
        lastName,
        email: normalizedEmail,
        passwordHash,
        registrationType,
        role,
        ...(referrer
          ? {
              referredBy: {
                create: {
                  referrerUserId: referrer.id,
                  refereeName:
                    [firstName, lastName].filter(Boolean).join(' ') ||
                    'New merchant',
                  rewardAmount: 0,
                },
              },
            }
          : {}),

        authProvider: normalizedPhone ? 'PHONE' : 'EMAIL',

        // TEMPORARY: OTP verification bypassed
        isVerified: true,

        // Since email verification is currently bypassed too
        emailVerified: Boolean(normalizedEmail),
      },
    });

    // ============================================================
    // GENERATE LOGIN TOKEN
    // ============================================================

    const accessToken = await this.generateToken(user);

    return {
      message: 'Account created successfully.',
      accessToken,
      user: this.toPublicUser(user),
    };
  }

  // ============================================================
  // LOGIN
  // ============================================================
  async login(loginDto: LoginDto) {
    const { email, phone, password } = loginDto;
    const normalizedEmail = email?.trim().toLowerCase();
    const normalizedPhone = phone ? normalizePhone(phone) : undefined;

    if (!email && !phone) {
      throw new ConflictException('Email or phone number is required.');
    }

    const user = normalizedEmail
      ? await this.prisma.user.findUnique({
          where: {
            email: normalizedEmail,
          },
          include: {
            vendorProfile: {
              select: { setupCompleted: true, storeName: true },
            },
          },
        })
      : await this.prisma.user.findFirst({
          where: {
            phone: { in: phoneLookupCandidates(normalizedPhone!) },
          },
          include: {
            vendorProfile: {
              select: { setupCompleted: true, storeName: true },
            },
          },
        });

    if (!user) {
      throw new UnauthorizedException('Invalid email/phone or password.');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('Invalid email/phone or password.');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email/phone or password.');
    }

    const accessToken = await this.generateToken(user);

    return {
      message: 'Login successful.',
      accessToken,
      user: this.toPublicUser(user),
    };
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        vendorProfile: { select: { setupCompleted: true, storeName: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return this.toPublicUser(user);
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const { firstName, lastName, dateOfBirth, state, city, interests } =
      updateProfileDto;

    let interestIds: string[] | undefined;
    if (interests !== undefined) {
      const uniqueSlugs = [
        ...new Set(
          interests.map((slug) => slug.trim().toLowerCase()).filter(Boolean),
        ),
      ];
      const interestRecords = await this.prisma.interest.findMany({
        where: {
          slug: {
            in: uniqueSlugs,
          },
        },
        select: {
          id: true,
          slug: true,
        },
      });
      if (interestRecords.length !== uniqueSlugs.length) {
        throw new BadRequestException(
          'One or more selected interests are invalid.',
        );
      }
      interestIds = interestRecords.map((interest) => interest.id);
    }

    const updatedUser = await this.prisma.user.update({
      where: {
        id: userId,
      },

      data: {
        ...(firstName !== undefined && {
          firstName: firstName.trim(),
        }),

        ...(lastName !== undefined && {
          lastName: lastName.trim(),
        }),

        ...(dateOfBirth !== undefined && {
          dateOfBirth: dateOfBirth,
        }),

        ...(state !== undefined && {
          state: state.trim(),
        }),

        ...(city !== undefined && {
          city: city.trim(),
        }),
        ...(interestIds !== undefined && {
          interests: {
            set: interestIds.map((id) => ({
              id,
            })),
          },
        }),
      },
      include: {
        interests: true,
      },
    });

    return {
      message: 'Profile updated successfully.',
      user: this.toPublicUser(updatedUser),
    };
  }

  private toPublicUser<
    T extends {
      passwordHash: unknown;
      vendorProfile?: { setupCompleted: boolean; storeName?: string } | null;
    },
  >(user: T) {
    const { passwordHash: _passwordHash, vendorProfile, ...publicUser } = user;
    void _passwordHash;
    return {
      ...publicUser,
      vendorSetupCompleted: vendorProfile?.setupCompleted ?? false,
      merchantStoreName: vendorProfile?.storeName ?? null,
    };
  }
}
