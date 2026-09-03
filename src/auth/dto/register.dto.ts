import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { RegistrationType } from 'generated/prisma/enums';

export class RegisterDto {
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
