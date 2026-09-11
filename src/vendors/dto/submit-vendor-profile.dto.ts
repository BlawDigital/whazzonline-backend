import { Equals, IsIn, IsString } from 'class-validator';

export class SubmitVendorProfileDto {
  @IsString()
  @IsIn(['RETAILER', 'WHOLESALER', 'BOTH'])
  sellerType!: 'RETAILER' | 'WHOLESALER' | 'BOTH';

  @Equals(true, { message: 'You must accept the vendor terms and policy.' })
  termsAccepted!: true;
}
