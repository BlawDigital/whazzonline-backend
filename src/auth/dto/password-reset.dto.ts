import { IsEmail, IsNotEmpty, IsString, Length, MinLength } from 'class-validator';

export class PasswordResetRequestDto {
  @IsEmail()
  email!: string;
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
