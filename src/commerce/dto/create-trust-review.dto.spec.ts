import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateTrustReviewDto } from './create-trust-review.dto';

describe('CreateTrustReviewDto', () => {
  it('accepts a completed-order trust reason', async () => {
    const dto = plainToInstance(CreateTrustReviewDto, {
      orderId: 'order-id',
      reason: 'The product arrived exactly as described.',
      vendorId: 'vendor-id',
    });
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects a reason that is too short', async () => {
    const dto = plainToInstance(CreateTrustReviewDto, {
      orderId: 'order-id',
      reason: 'Good',
      vendorId: 'vendor-id',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'reason')).toBe(true);
  });
});
