import { Type } from 'class-transformer';
import { IsIn, IsInt, Min } from 'class-validator';

export class CreateProductOfferDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  promoPrice!: number;

  @Type(() => Number)
  @IsInt()
  @IsIn([24, 72])
  durationHours!: 24 | 72;
}
