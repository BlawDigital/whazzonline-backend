import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTrustReviewDto {
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
