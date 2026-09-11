import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class AddCartItemDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() vendorId?: string;
  @IsOptional() @IsString() vendorName?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() imageUri?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsInt() @Min(0) unitPrice?: number;
  @IsOptional() @IsInt() @Min(0) originalPrice?: number;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsString() selectedColor?: string;
  @IsOptional() @IsString() selectedSize?: string;
  @IsOptional() @IsObject() selectedVariants?: Record<string, string>;
  @IsString() deliveryAddress!: string;
}
