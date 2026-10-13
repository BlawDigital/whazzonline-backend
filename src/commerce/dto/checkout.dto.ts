import { Type } from 'class-transformer';
import {
  ArrayMinSize,
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

class CheckoutCartItemDto {
  @IsString() cartItemId!: string;
  @IsInt() @Min(1) quantity!: number;
}

export class CheckoutDto {
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  address!: DeliveryAddressDto;

  @IsOptional() @IsInt() @Min(1) itemCount?: number;
  @IsIn(['wallet', 'bank', 'card', 'bnpl', 'pay_on_delivery']) paymentMethod!: string;
  @IsOptional()
  @IsNumber()
  @Min(0)
  total?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CheckoutCartItemDto)
  cartSelection?: CheckoutCartItemDto[];

  // Kept temporarily so older app builds remain accepted. Checkout uses the
  // authenticated server cart instead of trusting these client product fields.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddCartItemDto)
  items?: AddCartItemDto[];
}

