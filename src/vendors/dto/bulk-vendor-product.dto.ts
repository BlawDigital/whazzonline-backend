import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class BulkVendorProductDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  productIds!: string[];

  @IsIn(['PUBLISH', 'UNPUBLISH', 'DRAFT', 'DELETE', 'CATEGORY'])
  action!: 'PUBLISH' | 'UNPUBLISH' | 'DRAFT' | 'DELETE' | 'CATEGORY';

  @ValidateIf((dto: BulkVendorProductDto) => dto.action === 'CATEGORY')
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  mainCategory?: string;
}
