import {
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";

import { OtpService } from "./otp/otp.service";
import { PrismaService } from "prisma/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly otpService: OtpService,
    ) {}

    // ============================================================
    // PHONE OTP
    // ============================================================

    async sendPhoneOtp(phone: string) {
        return this.otpService.sendPhoneOtp(phone);
    }

    async verifyPhoneOtp(phone: string, code: string) {
        return this.otpService.verifyPhoneOtp(phone, code);
    }

    // ============================================================
    // REGISTER
    // ============================================================

    async register(registerDto: RegisterDto) {
        const {
            phone,
            fullName,
            accountType,
        } = registerDto;

        // Check if phone is already registered
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

        // Create account
        const user = await this.prisma.user.create({
            data: {
                phone,
                fullName,
                accountType,
            },
        });

        return {
            message: "Account created successfully.",
            user,
        };
    }

    // ============================================================
    // LOGIN
    // ============================================================

    async login(loginDto: LoginDto) {
        const { phone } = loginDto;

        // Find account
        const user = await this.prisma.user.findUnique({
            where: {
                phone,
            },
        });

        if (!user) {
            throw new NotFoundException(
                "No account was found with this phone number.",
            );
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

        return {
            message: "Login successful.",
            user,
        };
    }
}