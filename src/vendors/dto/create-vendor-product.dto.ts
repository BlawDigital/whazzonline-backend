import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsArray,
  Matches,
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
  @IsString()
  @Matches(/^#[0-9a-f]{6}$/i)
  colorHex?: string;

  @IsOptional()
  @IsObject()
  options?: Record<string, string>;

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
  @IsIn(['DRAFT', 'ACTIVE'])
  status?: 'DRAFT' | 'ACTIVE';

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

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(80)
  brand?: string;

  @IsOptional()
  @IsIn(['NEW', 'USED', 'REFURBISHED'])
  condition?: 'NEW' | 'USED' | 'REFURBISHED';

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
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
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
  @ArrayMaxSize(100)
  variants: VendorProductVariantDto[] = [];
}
