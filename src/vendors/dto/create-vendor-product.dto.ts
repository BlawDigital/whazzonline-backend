import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class VendorProductVariantDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  size?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  imageIndexes: number[] = [];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity!: number;
}

export class CreateVendorProductDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  promoPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([24, 72])
  promoDurationHours?: 24 | 72;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  category!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mainCategory?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value as unknown[];
    if (typeof value !== 'string' || value.trim() === '') return [];
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  })
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  subCategories: string[] = [];

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string' || value.trim() === '') return {};
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  })
  @IsObject()
  specifications: Record<string, string> = {};

  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitPrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return plainToInstance(VendorProductVariantDto, value);
    }
    if (typeof value !== 'string' || value.trim() === '') return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? plainToInstance(VendorProductVariantDto, parsed)
        : parsed;
    } catch {
      return value;
    }
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VendorProductVariantDto)
  variants: VendorProductVariantDto[] = [];
}
