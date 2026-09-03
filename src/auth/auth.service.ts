import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EmailOtpPurpose } from 'generated/prisma/enums';

import { OtpService } from "./otp/otp.service";
import { PrismaService } from "prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import * as bcrypt from "bcrypt";
import { JwtService } from "@nestjs/jwt";
@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly otpService: OtpService,
        private readonly jwtService: JwtService,
    ) { }

    // ============================================================
    // PHONE OTP
    // ============================================================

    private async generateToken(user: { id: string; phone: string | null; email: string | null; }) {
        const payload = {
            sub: user.id,
            phone: user.phone,
            email: user.email,
        };

        return this.jwtService.signAsync(payload);
    }
    async sendPhoneOtp(phone: string) {
        return this.otpService.sendPhoneOtp(phone);
    }

    async verifyPhoneOtp(phone: string, code: string) {
        const verification = await this.otpService.verifyPhoneOtp(phone, code);
        const user = await this.prisma.user.findUnique({
            where: { phone: phone.trim() },
            include: { vendorProfile: { select: { setupCompleted: true } } },
        });

        return {
            ...verification,
            user: user ? this.toPublicUser(user) : null,
        };
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
        if (existing) throw new ConflictException('An account with this email already exists.');
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
            include: { vendorProfile: { select: { setupCompleted: true } } },
        });
        await this.prisma.emailOtp.update({
            where: { id: otpId },
            data: { consumedAt: new Date() },
        });
        return this.toPublicUser(user);
    }

    async requestPhoneChange(userId: string, phone: string) {
        const normalizedPhone = phone.trim();
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found.');
        if (user.phone === normalizedPhone) {
            throw new ConflictException('This is already the phone number on your account.');
        }
        const existing = await this.prisma.user.findUnique({
            where: { phone: normalizedPhone },
        });
        if (existing) throw new ConflictException('An account with this phone number already exists.');
        return this.otpService.sendPhoneOtp(normalizedPhone, 'PHONE_CHANGE');
    }

    async confirmPhoneChange(userId: string, phone: string, code: string) {
        const normalizedPhone = phone.trim();
        const existing = await this.prisma.user.findUnique({
            where: { phone: normalizedPhone },
        });
        if (existing && existing.id !== userId) {
            throw new ConflictException('An account with this phone number already exists.');
        }
        await this.otpService.verifyPhoneOtp(
            normalizedPhone,
            code,
            'PHONE_CHANGE',
        );
        const user = await this.prisma.user.update({
            where: { id: userId },
            data: { phone: normalizedPhone },
            include: { vendorProfile: { select: { setupCompleted: true } } },
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

    async requestPasswordReset(email: string) {
        const normalizedEmail = email.trim().toLowerCase();
        const user = await this.prisma.user.findUnique({
            where: { email: normalizedEmail },
        });
        // The public response does not reveal whether the address has an account.
        if (user) {
            await this.otpService.sendEmailOtp(
                normalizedEmail,
                'PASSWORD_RESET',
                user.id,
            );
        }
        return { message: 'If this email is linked to an account, a reset code has been sent.' };
    }

    async verifyPasswordReset(email: string, code: string) {
        const normalizedEmail = email.trim().toLowerCase();
        const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) throw new NotFoundException('No account was found for this email.');
        await this.otpService.verifyEmailOtp(
            normalizedEmail,
            code,
            'PASSWORD_RESET',
            user.id,
        );
        return { verified: true };
    }

    async resetPassword(email: string, code: string, password: string) {
        const normalizedEmail = email.trim().toLowerCase();
        const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) throw new NotFoundException('No account was found for this email.');
        await this.otpService.consumeVerifiedEmailOtp(
            normalizedEmail,
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
    async register(registerDto: RegisterDto) {
        const {
            phone,
            firstName,
            lastName,
            email,
            registrationType,
            password,
        } = registerDto;

        // Check phone
        const existingUser = await this.prisma.user.findUnique({
            where: {
                phone,
            },
        });

        if (existingUser) {
            throw new ConflictException(
                "An account with this phone number already exists.",
            );
        }

        // Check the MOST RECENT OTP
        const latestOtp = await this.prisma.phoneOtp.findFirst({
            where: {
                phone,
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        if (!latestOtp) {
            throw new ConflictException(
                "Please verify your phone number first.",
            );
        }

        // The latest OTP must be successfully verified
        if (!latestOtp.verified) {
            throw new ConflictException(
                "Please verify your phone number before creating an account.",
            );
        }

        // The latest OTP must not be expired
        if (latestOtp.expiresAt < new Date()) {
            throw new ConflictException(
                "Your OTP has expired. Please request a new OTP.",
            );
        }

        // Check email
        if (email) {
            const existingEmail = await this.prisma.user.findUnique({
                where: {
                    email,
                },
            });

            if (existingEmail) {
                throw new ConflictException(
                    "An account with this email already exists.",
                );
            }
        }

        // Hash password
        const passwordHash = password
            ? await bcrypt.hash(password, 12)
            : null;

        // Determine role
        const roleByRegistrationType = {
            BUYER: "CUSTOMER",
            SELLER: "VENDOR",
            BUSINESS: "BUSINESS",
        } as const;

        const role = roleByRegistrationType[registrationType];

        // Create account
        const user = await this.prisma.user.create({
            data: {
                phone,
                firstName,
                lastName,
                email,
                passwordHash,
                registrationType,
                role,
                authProvider: "PHONE",
                isVerified: true,
            },
        });

        const accessToken = await this.generateToken(user);

        return {
            message: "Account created successfully.",
            accessToken,
            user: this.toPublicUser(user),
        };
    }



    // ============================================================
    // LOGIN
    // ============================================================
    async login(loginDto: LoginDto) {
        const {
            email,
            phone,
            password,
        } = loginDto;

        if (!email && !phone) {
            throw new ConflictException(
                "Email or phone number is required.",
            );
        }

        const user = email
            ? await this.prisma.user.findUnique({
                where: {
                    email,
                },
                include: { vendorProfile: { select: { setupCompleted: true } } },
            })
            : await this.prisma.user.findUnique({
                where: {
                    phone,
                },
                include: { vendorProfile: { select: { setupCompleted: true } } },
            });

        if (!user) {
            throw new NotFoundException(
                "No account was found.",
            );
        }

        if (!user.passwordHash) {
            throw new ConflictException(
                "This account does not use password login.",
            );
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.passwordHash,
        );

        if (!passwordMatches) {
            throw new ConflictException(
                "Invalid email/phone or password.",
            );
        }
        const accessToken = await this.generateToken(user);
        return {
            message: "Login successful.",
            accessToken,
            user: this.toPublicUser(user),

        };
    }

    private toPublicUser<T extends {
        passwordHash: unknown;
        vendorProfile?: { setupCompleted: boolean } | null;
    }>(user: T) {
        const { passwordHash: _passwordHash, vendorProfile, ...publicUser } = user;
        return {
            ...publicUser,
            vendorSetupCompleted: vendorProfile?.setupCompleted ?? false,
        };
    }
    async getCurrentUser(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: {
                id: userId,
            },
        });

        if (!user) {
            throw new NotFoundException(
                "User not found.",
            );
        }

        return user;
    }
}