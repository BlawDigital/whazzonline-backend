import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SaveVendorProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  storeName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  category!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  subCategory!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  state!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  city!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lga!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  landmark?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;
}
