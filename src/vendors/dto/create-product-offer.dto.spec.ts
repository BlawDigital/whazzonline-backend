import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateProductOfferDto } from './create-product-offer.dto';

describe('CreateProductOfferDto', () => {
  it.each([24, 72])('accepts a %i-hour sales cycle', async (durationHours) => {
    const dto = plainToInstance(CreateProductOfferDto, {
      durationHours: String(durationHours),
      promoPrice: '110000',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects an undefined sales cycle', async () => {
    const dto = plainToInstance(CreateProductOfferDto, {
      durationHours: '48',
      promoPrice: '110000',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'durationHours')).toBe(
      true,
    );
  });
});
