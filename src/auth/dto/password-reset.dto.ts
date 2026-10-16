import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  MinLength,
  IsOptional,
  ValidateIf,
} from 'class-validator';

export class PasswordResetRequestDto {
  @ValidateIf(
    (value: PasswordResetRequestDto) =>
      value.email !== undefined || !value.phone,
  )
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phone?: string;
}

export class PasswordResetVerifyDto extends PasswordResetRequestDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class PasswordResetUpdateDto extends PasswordResetVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password!: string;
}
