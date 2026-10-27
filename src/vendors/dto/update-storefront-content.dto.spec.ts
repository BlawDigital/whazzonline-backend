import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStorefrontContentDto } from './update-storefront-content.dto';

const errors = (storefrontDetails: unknown) =>
  validate(plainToInstance(UpdateStorefrontContentDto, { storefrontDetails }), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
describe('Storefront public details validation', () => {
  it('accepts public contact details, a custom title and free-form business hours', async () => {
    expect(
      await errors({
        heading: 'Our story',
        representativeTitle: 'Founder & Creative Director',
        phone: '+234 812 345 6789',
        email: 'hello@example.com',
        handle: '@shop',
        businessHours: [
          { label: 'Mon - Fri', value: '9am - 7pm' },
          { label: 'Sunday', value: 'Closed' },
        ],
      }),
    ).toEqual([]);
    expect(await errors({ email: '', businessHours: [] })).toEqual([]);
  });
  it('rejects malformed email, unknown fields and malformed hours', async () => {
    for (const details of [
      { email: 'invalid' },
      { privateBankAccount: '1234' },
      { businessHours: [{ label: 'Sunday', value: '' }] },
      { businessHours: Array(15).fill({ label: 'Day', value: 'Closed' }) },
    ])
      expect((await errors(details)).length).toBeGreaterThan(0);
  });
});
