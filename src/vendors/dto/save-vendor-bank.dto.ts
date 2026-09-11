import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class SaveVendorBankDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  bankName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  bankCode!: string;

  @IsString()
  @Matches(/^\d{10}$/, {
    message: 'Account number must contain exactly 10 digits.',
  })
  accountNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  accountName!: string;
}
