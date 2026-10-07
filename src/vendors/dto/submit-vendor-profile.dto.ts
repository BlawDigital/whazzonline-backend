import { Equals, IsIn, IsString, MinLength, MaxLength } from 'class-validator';

export class SubmitVendorProfileDto {
  @IsString() @MinLength(2) @MaxLength(120) representativeName!: string;
  @IsIn(['CEO', 'Authorized representative']) representativeRole!: string;
  @IsString()
  @IsIn(['RETAILER', 'WHOLESALER', 'BOTH'])
  sellerType!: 'RETAILER' | 'WHOLESALER' | 'BOTH';

  @Equals(true, { message: 'You must accept the vendor terms and policy.' })
  termsAccepted!: true;
}
