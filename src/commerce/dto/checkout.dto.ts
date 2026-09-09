import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { AddCartItemDto } from './add-cart-item.dto';

class DeliveryAddressDto {
  @IsString() label!: string;
  @IsNumber() latitude!: number;
  @IsNumber() longitude!: number;
}

export class CheckoutDto {
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  address!: DeliveryAddressDto;

  @IsInt() @Min(1) itemCount!: number;
  @IsIn(['wallet', 'bank', 'card', 'bnpl']) paymentMethod!: string;
  @IsInt() @Min(0) total!: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddCartItemDto)
  items?: AddCartItemDto[];
}
