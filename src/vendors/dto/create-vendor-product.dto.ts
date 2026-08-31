import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class VendorProductVariantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  type!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity!: number;
}

export class CreateVendorProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  category!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

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
