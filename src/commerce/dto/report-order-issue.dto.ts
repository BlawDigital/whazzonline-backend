import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ReportOrderIssueDto {
  @IsString() orderId!: string;
  @IsOptional() @IsString() itemId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsIn([
    'Damaged item',
    'Wrong product',
    'Counterfeit product',
    'Unmatched product',
  ])
  type!: string;
  @IsString() @MinLength(1) @MaxLength(800) description!: string;
}
