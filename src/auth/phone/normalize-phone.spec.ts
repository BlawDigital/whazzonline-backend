import { BadRequestException } from '@nestjs/common';

import { normalizePhone, phoneLookupCandidates } from './normalize-phone';

describe('normalizePhone', () => {
  it.each([
    ['07047160204', '+2347047160204'],
    ['7047160204', '+2347047160204'],
    ['2347047160204', '+2347047160204'],
    ['+234 704 716 0204', '+2347047160204'],
    ['00234 704 716 0204', '+2347047160204'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('rejects values that are not phone numbers', () => {
    expect(() => normalizePhone('phone')).toThrow(BadRequestException);
  });

  it('uses legacy Nigerian storage forms when finding an existing account', () => {
    expect(phoneLookupCandidates('07047160204')).toEqual([
      '+2347047160204',
      '07047160204',
      '7047160204',
      '2347047160204',
    ]);
  });
});
