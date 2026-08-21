import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import { RegistrationType } from "generated/prisma/enums";

export class RegisterDto {
    @IsString()
    @IsNotEmpty()
    phone!: string;

    @IsString()
    @IsNotEmpty()
    firstName!: string;

    @IsString()
    @IsNotEmpty()
    lastName!: string;


    @IsOptional()
    @IsEmail()
    email?: string;

   @IsEnum(RegistrationType)
    registrationType!: RegistrationType;

    @IsNotEmpty()
    @IsString()
    @MinLength(8)
    password!: string;
}