import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class AddCartItemDto {
  @IsString() productId!: string;
  @IsString() vendorId!: string;
  @IsString() vendorName!: string;
  @IsString() name!: string;
  @IsString() subtitle!: string;
  @IsString() imageUri!: string;
  @IsString() sku!: string;
  @IsInt() @Min(0) unitPrice!: number;
  @IsOptional() @IsInt() @Min(0) originalPrice?: number;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsString() selectedColor?: string;
  @IsOptional() @IsString() selectedSize?: string;
  @IsOptional() @IsObject() selectedVariants?: Record<string, string>;
  @IsString() deliveryAddress!: string;
}
