import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ContentDto {
  @IsIn(['STORY', 'SCROLL']) kind!: 'STORY' | 'SCROLL';
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsOptional() @IsString() @MaxLength(3000) caption?: string;
  @IsOptional()
  @IsIn([
    'UPDATE',
    'NEW_IN',
    'BEST_SELLER',
    'HOW_TO',
    'FAQ',
    'OFFER',
    'ANNOUNCEMENT',
    'PARTNERSHIP',
  ])
  topic?: string;
}
export class FeedDto {
  @IsOptional() @IsIn(['STORY', 'SCROLL']) kind?: 'STORY' | 'SCROLL';
  @IsOptional() @IsUUID() merchantId?: string;
  @IsOptional() @IsIn(['true', 'false']) verified?: string;
  @IsOptional() @IsIn(['true', 'false']) savedOnly?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}
export class UpdateContentDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(3000) caption?: string;
  @IsOptional()
  @IsIn([
    'UPDATE',
    'NEW_IN',
    'BEST_SELLER',
    'HOW_TO',
    'FAQ',
    'OFFER',
    'ANNOUNCEMENT',
    'PARTNERSHIP',
  ])
  topic?: string;
}
export class ProductReviewDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @IsString() @MinLength(3) @MaxLength(2000) comment!: string;
}
export class AisleDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsOptional() @IsUUID() parentId?: string;
}
export class AssignAisleDto {
  @IsOptional() @IsUUID() aisleId?: string | null;
}
