import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  Matches,
} from 'class-validator';
import { RegistrationType } from 'generated/prisma/enums';

export class RegisterDto {
  @IsOptional()
  @Matches(/^[a-zA-Z0-9_-]{8,64}$/)
  referralCode?: string;
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsEnum(RegistrationType)
  registrationType!: RegistrationType;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
