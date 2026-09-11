import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class ReturnItemDto {
  @IsString() itemId!: string;
  @IsOptional() @IsString() productId?: string;
  @IsInt() @Min(1) quantity!: number;
}

export class CreateReturnDto {
  @IsString() orderId!: string;
  @IsString() @MaxLength(800) description!: string;
  @IsIn([
    'Item is damaged or defective',
    'Item received is different from what was ordered',
    'Wrong size or variant received',
    'Item is of poor quality',
    'Item arrived too late',
    'I changed my mind',
    'Duplicate order placed by mistake',
    'Other — I’ll describe it below',
  ])
  reason!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];
}
