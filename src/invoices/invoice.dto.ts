import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsInt,
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
  @IsString() @MinLength(2) @MaxLength(120) reference!: string;
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
