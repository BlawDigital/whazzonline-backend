import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
export class ReferralQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional()
  @IsIn([
    'COMPLETED',
    'PENDING',
    'QUALIFIED',
    'REWARDED',
    'INELIGIBLE',
    'VOIDED',
  ])
  status?:
    | 'COMPLETED'
    | 'PENDING'
    | 'QUALIFIED'
    | 'REWARDED'
    | 'INELIGIBLE'
    | 'VOIDED';
}
