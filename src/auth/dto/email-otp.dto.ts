import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class EmailOtpRequestDto {
  @IsEmail()
  email!: string;
}

export class EmailOtpVerifyDto extends EmailOtpRequestDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}
