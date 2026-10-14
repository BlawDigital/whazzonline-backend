import { IsUUID, Matches } from 'class-validator';

import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class GuestDeliveryAddressDto {
  @IsString()
  label!: string;

  @IsNumber()
  latitude!: number;

  @IsNumber()
  longitude!: number;
}

class GuestCheckoutItemDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  selectedColor?: string;

  @IsOptional()
  @IsString()
  selectedSize?: string;

  @IsOptional()
  @IsObject()
  selectedVariants?: Record<string, string>;
}

export class GuestCheckoutDto {
  @IsOptional() @IsUUID() idempotencyKey?: string;
  @IsOptional() @Matches(/^[a-f0-9]{64}$/) guestAccessToken?: string;
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  phone!: string;

  @ValidateNested()
  @Type(() => GuestDeliveryAddressDto)
  address!: GuestDeliveryAddressDto;

  @IsIn(['card', 'bank', 'pay_on_delivery'])
  paymentMethod!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GuestCheckoutItemDto)
  items!: GuestCheckoutItemDto[];
}
