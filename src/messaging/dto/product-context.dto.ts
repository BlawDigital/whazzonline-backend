import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ProductContextDto {
  @IsOptional() @IsString() @MaxLength(100) clientMessageId?: string;
  @IsOptional() @IsString() @MaxLength(100) productId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000000) quantity?: number;
  @IsOptional() @IsObject() selectedVariants?: Record<string, string>;
}
