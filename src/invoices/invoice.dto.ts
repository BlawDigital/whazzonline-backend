import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsInt,
  IsNumber,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
export class TransferReportDto {
  @IsUUID() requestId!: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) remitterName?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000000)
  transferAmount?: number;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class ConfirmInvoiceDto {
  @Equals(true) received!: true;
  @IsString() @MinLength(2) @MaxLength(120) reference!: string;
}
export class RejectTransferDto {
  @IsUUID() reportId!: string;
  @IsString() @MinLength(2) @MaxLength(500) note!: string;
}
export class ConnectMerchantPaymentDto {
  @Matches(/^sk_(test|live)_[a-zA-Z0-9]{16,100}$/) secretKey!: string;
}
class InvoiceProductDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) @Max(10000) quantity!: number;
  @IsOptional() @IsObject() selectedVariants?: Record<string, string>;
}
export class CheckoutQuoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InvoiceProductDto)
  items!: InvoiceProductDto[];
  @IsOptional() @IsString() @MaxLength(500) deliveryAddress?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000000) deliveryFee?: number;
}
export class ChatInvoiceDto {
  @IsUUID() requestId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => InvoiceProductDto)
  items!: InvoiceProductDto[];
  @IsString() @MinLength(3) @MaxLength(500) deliveryAddress!: string;
  @IsInt() @Min(0) @Max(10000000) deliveryFee!: number;
}
class InvoiceBuyerDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsUUID() userId?: string;
}
export class MerchantOrderInvoiceDto extends ChatInvoiceDto {
  @IsOptional() @IsUUID() conversationId?: string;
  @ValidateNested() @Type(() => InvoiceBuyerDto) buyer!: InvoiceBuyerDto;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsIn(['sms', 'email'], { each: true })
  channels!: ('sms' | 'email')[];
  @Matches(/^[a-f0-9]{64}$/) guestAccessToken!: string;
}
