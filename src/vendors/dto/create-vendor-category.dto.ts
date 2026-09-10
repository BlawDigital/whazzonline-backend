import { IsIn, IsString } from 'class-validator';

export const VENDOR_CATEGORY_NAMES = [
  'Men Fashion',
  'Women Fashion',
  'Phone & Computing',
  'Consumer Electronics',
  'Home & Gardens',
  'Beauty & Health',
  'Baby, Kids & Toys',
  'Shoe',
  'Sweat-shirt',
  'Cap',
] as const;

export class CreateVendorCategoryDto {
  @IsString()
  @IsIn(VENDOR_CATEGORY_NAMES)
  name!: string;
}
