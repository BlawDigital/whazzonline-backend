import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class StoreCommunityQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(['recent', 'highest', 'lowest']) sort?:
    'recent' | 'highest' | 'lowest';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 10;
}
export class ReviewVoteDto {
  @IsOptional() @IsBoolean() helpful?: boolean | null;
}
