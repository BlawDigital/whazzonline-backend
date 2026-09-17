function numberSetting(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const vendorFinanceConfig = {
  minimumWithdrawalAmount: numberSetting(
    process.env.VENDOR_MINIMUM_WITHDRAWAL_NAIRA,
    100,
  ),
  platformFeePercent: numberSetting(
    process.env.VENDOR_PLATFORM_FEE_PERCENT,
    10,
  ),
};
