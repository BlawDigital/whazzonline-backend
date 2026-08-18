import { IsNotEmpty, IsString } from "class-validator";

export class SendPhoneOtpDto{
    @IsString()
    @IsNotEmpty()
    phone!: string;
}