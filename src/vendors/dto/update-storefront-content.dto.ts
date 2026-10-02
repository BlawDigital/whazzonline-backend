import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateStorefrontContentDto {
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
