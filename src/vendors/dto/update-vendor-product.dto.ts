import { Type } from 'class-transformer';
import { VendorProductVariantDto } from './create-vendor-product.dto';
import {
  IsInt,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateVendorProductDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(() => VendorProductVariantDto) variants?: VendorProductVariantDto[];
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @IsOptional() @IsInt() @Min(0) quantity?: number;
  @IsOptional() @IsInt() @Min(1) unitPrice?: number;
}
