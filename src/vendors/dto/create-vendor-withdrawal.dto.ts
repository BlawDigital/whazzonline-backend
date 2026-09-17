import { IsInt, Min } from 'class-validator';

import { vendorFinanceConfig } from '../vendor-finance.config';

export class CreateVendorWithdrawalDto {
  @IsInt()
  @Min(vendorFinanceConfig.minimumWithdrawalAmount, {
    message: `The minimum withdrawal amount is N${vendorFinanceConfig.minimumWithdrawalAmount}.`,
  })
  amount!: number;
}
