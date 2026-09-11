import { ConflictException, Injectable, NotFoundException, } from "@nestjs/common";

import { OtpService } from "./otp/otp.service";
import { PrismaService } from "prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import * as bcrypt from "bcrypt";
import { JwtService } from "@nestjs/jwt";
import { UpdateProfileDto } from "./dto/update-profile";
import { first } from "rxjs";
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
            throw new ConflictException("Email or phone number is required.",);
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
            throw new NotFoundException("No account was found.",);
        }

        if (!user.passwordHash) {
            throw new ConflictException("This account does not use password login.",);
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

    private toPublicUser<T extends { passwordHash: unknown }>(user: T) {
        const { passwordHash: _passwordHash, ...publicUser } = user;
        return publicUser;
    }
    async getCurrentUser(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: {
                id: userId,
            },
        });

        if (!user) {
            throw new NotFoundException("User not found.",);
        }
        return user;
    }


    async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
        const user = await this.prisma.user.findUnique({
            where: {
                id: userId,
            },
        });
        if (!user) {
            throw new NotFoundException("User not found.",);
        }
        const {
            firstName,
            lastName,
            dateOfBirth,
            state,
            city,
        } = updateProfileDto;

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
                    dateOfBirth: new Date(dateOfBirth),
                }),
                ...(state !== undefined && {
                    state: state.trim(),
                }),
                ...(city !== undefined && {
                    city: city.trim(),
                }),
            },
        });
        return {
            message: "Profile updated successfully",
            user: this.toPublicUser(updatedUser),
        };
    }
}