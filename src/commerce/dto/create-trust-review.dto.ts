import {
  IsInt,
  IsOptional,
  Min,
  Max,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTrustReviewDto {
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @IsString()
  @IsNotEmpty()
  vendorId!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
