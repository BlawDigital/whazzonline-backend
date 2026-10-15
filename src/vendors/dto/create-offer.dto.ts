import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsISO8601,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum CreateOfferType {
  PRICE_DISCOUNT = 'PRICE_DISCOUNT',
  BUNDLE_DEAL = 'BUNDLE_DEAL',
  DELIVERY = 'DELIVERY',
  FLASH_SALE = 'FLASH_SALE',
}

export enum CreateOfferDiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  FIXED_PRICE = 'FIXED_PRICE',
}

export enum CreateDeliveryOfferType {
  FREE = 'FREE',
  REDUCED = 'REDUCED',
}

export class CreateOfferDto {
  @IsEnum(CreateOfferType)
  type!: CreateOfferType;

  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  productIds!: string[];

  @IsInt()
  @IsIn([24, 48, 72, 100])
  @Type(() => Number)
  durationHours!: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  mediaUrls?: string[];

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISH'])
  intent?: 'DRAFT' | 'PUBLISH';

  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  @Type(() => Number)
  stockLimit?: number;

  @IsOptional()
  @IsEnum(CreateOfferDiscountType)
  discountType?: CreateOfferDiscountType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  discountValue?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  bundlePrice?: number;

  @IsOptional()
  @IsEnum(CreateDeliveryOfferType)
  deliveryType?: CreateDeliveryOfferType;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  deliveryFee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  minimumOrderValue?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  applicableLocations?: string[];
}
