import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateStorefrontContentDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) category?: string;
  @IsOptional() @IsString() @MaxLength(100) subCategory?: string;
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(300)
  description?: string;
}
