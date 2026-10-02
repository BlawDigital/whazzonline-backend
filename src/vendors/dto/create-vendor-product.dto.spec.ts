import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateVendorProductDto } from './create-vendor-product.dto';

describe('CreateVendorProductDto', () => {
  it('transforms multipart numbers and variant JSON', async () => {
    const dto = plainToInstance(CreateVendorProductDto, {
      category: 'Fashion & Apparel',
      name: 'Jorani air sneakers',
      quantity: '3',
      unitPrice: '134000',
      variants: '[{"type":"Black / 42","quantity":2}]',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto).toMatchObject({
      quantity: 3,
      unitPrice: 134000,
      variants: [{ quantity: 2, type: 'Black / 42' }],
    });
  });

  it('rejects malformed variant JSON', async () => {
    const dto = plainToInstance(CreateVendorProductDto, {
      category: 'Fashion & Apparel',
      name: 'Jorani air sneakers',
      quantity: '3',
      unitPrice: '134000',
      variants: 'not-json',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'variants')).toBe(true);
  });

  it('accepts color and size variants linked to uploaded image indexes', async () => {
    const dto = plainToInstance(CreateVendorProductDto, {
      category: 'Fashion & Apparel',
      name: 'Jorani air sneakers',
      quantity: '3',
      unitPrice: '134000',
      variants:
        '[{"color":"Black","size":"42","quantity":2,"imageIndexes":[0,1]}]',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.variants).toEqual([
      { color: 'Black', size: '42', quantity: 2, imageIndexes: [0, 1] },
    ]);
  });

  it('rejects a third subcategory', async () => {
    const dto = plainToInstance(CreateVendorProductDto, {
      category: 'Fashion & Apparel',
      name: 'Jorani air sneakers',
      quantity: '3',
      subCategories: '["Men","Shoes","Sneakers"]',
      unitPrice: '134000',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'subCategories')).toBe(
      true,
    );
  });
});
