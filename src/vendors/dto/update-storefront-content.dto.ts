import {
  IsArray,
  ArrayMaxSize,
  IsIn,
  IsUrl,
  ValidateNested,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  IsEmail,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MerchantLinkDto {
  @IsString() @MinLength(1) @MaxLength(60) label!: string;
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  url!: string;
}

export class StoreBusinessHourDto {
  @IsString() @MinLength(1) @MaxLength(60) label!: string;
  @IsString() @MinLength(1) @MaxLength(80) value!: string;
}
export class StorefrontDetailsDto {
  @IsOptional() @IsString() @MaxLength(160) heading?: string;
  @IsOptional() @IsString() @MaxLength(120) representativeTitle?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional()
  @IsString()
  @MaxLength(254)
  @ValidateIf((_object: unknown, value: unknown) => value !== '')
  @IsEmail()
  email?: string;
  @IsOptional() @IsString() @MaxLength(80) handle?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => StoreBusinessHourDto)
  businessHours?: StoreBusinessHourDto[];
}

export class UpdateStorefrontContentDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => StorefrontDetailsDto)
  storefrontDetails?: StorefrontDetailsDto;
  @IsOptional() @IsString() @MaxLength(10000) about?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MerchantLinkDto)
  socialLinks?: MerchantLinkDto[];
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  representativeName?: string;
  @IsOptional()
  @IsIn(['CEO', 'Authorized representative'])
  representativeRole?: string;
  @IsOptional() @IsString() @MaxLength(2000) representativeBio?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) storeName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) state?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) lga?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(240) address?: string;
  @IsOptional() @IsString() @MaxLength(160) landmark?: string;
  @IsOptional() @IsUUID() featuredProductId?: string | null;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) category?: string;
  @IsOptional() @IsString() @MaxLength(100) subCategory?: string;
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(300)
  description?: string;
}
