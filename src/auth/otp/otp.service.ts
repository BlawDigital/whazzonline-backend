import { BadRequestException, Inject, Injectable} from "@nestjs/common";
import { PrismaService } from "prisma/prisma.service";
import * as bcrypt from "bcrypt";
import { OTP_PROVIDER, type OtpProvider } from "./otp.provider";

@Injectable()

export class OtpService {
    private readonly OTP_EXPIRY_MINUTES = 2;
    private readonly MAX_ATTEMPTS = 5;

    constructor(private readonly prisma: PrismaService, @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,) { }


    async sendPhoneOtp(phone: string) {
        const normalizedPhone = phone.trim();
        const existingOtp = await this.prisma.phoneOtp.findFirst({
            where: {
                phone: normalizedPhone,
                verified: false,
                expiresAt: {
                    gt: new Date(),
                },
            },
            orderBy: {
                createdAt: "desc",
            },
        });
        if (existingOtp) {
            throw new BadRequestException("A verification code has already been sent. Please wait before requesting another.",);
        }
        //Generate six-digit otp

        const otp = Math.floor(100000 + Math.random() * 900000,).toString();

        const codeHash = await bcrypt.hash(otp, 10);

        const expiresAt = new Date(Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000,);

        await this.prisma.phoneOtp.create({
            data: {
                phone: normalizedPhone,
                codeHash,
                expiresAt,
                attempts: 0,
                verified: false,
            },
        });

        await this.otpProvider.sendOtp(normalizedPhone, otp);

        return {
            message: "Verification code sent.",
            expiresIn: this.OTP_EXPIRY_MINUTES * 60,
        };
    }

    async verifyPhoneOtp(phone: string, code: string,) {
        const normalizedPhone = phone.trim();

        const otpRecord = await this.prisma.phoneOtp.findFirst({
            where:{
                phone: normalizedPhone,
                verified: false,
            },
            orderBy: {
                createdAt: "desc",
            },
        });
        if(!otpRecord){
            throw new BadRequestException("No verification code found.",);
        }

        if(otpRecord.expiresAt < new Date()){
            throw new BadRequestException("Verification code has expired. Please request a new code.",);
        }
        if(otpRecord.attempts >= this.MAX_ATTEMPTS){
            throw new BadRequestException(
                "Too many incorrect attempts. Please request a new code.",
            );
        }
        const isValid = await bcrypt.compare(code, otpRecord.codeHash);
        if(!isValid){
            await this.prisma.phoneOtp.update({
                where:{
                    id: otpRecord.id,
                },
                data:{
                    attempts:{
                        increment: 1,
                    },
                },
            });
            return {
                message:" Phone number verified successfully.",
                verified: true,
            };
        };
    }
}