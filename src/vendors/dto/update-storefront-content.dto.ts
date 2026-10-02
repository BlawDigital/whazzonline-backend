import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateStorefrontContentDto {
  @IsOptional() @IsUUID() featuredProductId?: string | null;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) category?: string;
  @IsOptional() @IsString() @MaxLength(100) subCategory?: string;
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(300)
  description?: string;
}
