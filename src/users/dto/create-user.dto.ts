import { IsEmail, IsEnum, IsOptional, IsPhoneNumber, IsString, MinLength } from "class-validator";
import { AuthProvider, UserRole } from "generated/prisma/enums";

export class CreateUserDto{
    @IsOptional()
    @IsString()
    @MinLength(2)
    firstName?: string;

    @IsOptional()
    @IsString()
    @MinLength(2)
    lastName?:string;


    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsPhoneNumber()
    phone?: string;


    @IsOptional()
    @IsEnum(AuthProvider)
    authProvider?: AuthProvider;

    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;
}