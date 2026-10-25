import { IsIn, IsInt, IsUUID, Matches, Min } from 'class-validator';
export class WalletChallengeDto {
  @IsIn(['email', 'phone']) channel!: 'email' | 'phone';
}
export class WalletPinDto {
  @IsUUID() challengeId!: string;
  @Matches(/^\d{6}$/) code!: string;
  @Matches(/^\d{4}$/) pin!: string;
}
export class WalletPaymentDto {
  @Matches(/^\d{4}$/) pin!: string;
  @IsInt() @Min(1) expectedTotal!: number;
  @IsUUID() requestId!: string;
}
