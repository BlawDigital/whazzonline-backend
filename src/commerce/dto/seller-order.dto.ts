import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class RejectSellerOrderDto {
  @IsString() @MinLength(3) @MaxLength(800) reason!: string;
}
export class UpdateSellerOrderDto {
  @IsIn(['processing', 'ready', 'out_for_delivery', 'delivered'])
  status!: string;
}
export class IssueReplyDto {
  @IsString() @MinLength(1) @MaxLength(4000) text!: string;
}
export class DeliveryRequestDto {
  @IsIn(['standard', 'priority']) serviceLevel!: 'standard' | 'priority';
}
export class CreateSellerDisputeDto {
  @IsString() @MinLength(3) @MaxLength(160) reason!: string;
  @IsString() @MinLength(3) @MaxLength(4000) description!: string;
}
