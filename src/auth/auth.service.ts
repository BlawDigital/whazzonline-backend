import { ConflictException, Injectable, NotFoundException, } from "@nestjs/common";

import { OtpService } from "./otp/otp.service";
import { PrismaService } from "prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import * as bcrypt from "bcrypt";
@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly otpService: OtpService,
    ) { }

    // ============================================================
    // PHONE OTP
    // ============================================================

    async sendPhoneOtp(phone: string) {
        return this.otpService.sendPhoneOtp(phone);
    }

    async verifyPhoneOtp(phone: string, code: string) {
        const verification = await this.otpService.verifyPhoneOtp(phone, code);
        const user = await this.prisma.user.findUnique({
            where: { phone: phone.trim() },
        });

        return {
            ...verification,
            user: user ? this.toPublicUser(user) : null,
        };
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
        const existingPhone = await this.prisma.user.findUnique({
            where: {
                phone,
            },
        });

        if (existingPhone) {
            throw new ConflictException(
                "An account with this phone number already exists.",
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

        // Check phone verification
        const verifiedOtp = await this.prisma.phoneOtp.findFirst({
            where: {
                phone,
                verified: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        if (!verifiedOtp) {
            throw new ConflictException(
                "Phone number has not been verified.",
            );
        }

        // Hash password
        const passwordHash = password ? await bcrypt.hash(password, 12) : null;

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

        return {
            message: "Account created successfully.",
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
            })
            : await this.prisma.user.findUnique({
                where: {
                    phone,
                },
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

        return {
            message: "Login successful.",
            user: this.toPublicUser(user),
        };
    }

    private toPublicUser<T extends { passwordHash: unknown }>(user: T) {
        const { passwordHash: _passwordHash, ...publicUser } = user;
        return publicUser;
    }
}
