import { BadRequestException } from '@nestjs/common';

export function normalizePhone(value: string) {
  const input = value.trim();
  const digits = input.replace(/\D/g, '');
  if (!digits) throw new BadRequestException('Enter a valid phone number.');

  let canonical: string;
  if (input.startsWith('+')) {
    canonical = `+${digits}`;
  } else if (digits.startsWith('00')) {
    canonical = `+${digits.slice(2)}`;
  } else if (digits.startsWith('2340')) {
    canonical = `+234${digits.slice(4)}`;
  } else if (digits.startsWith('234')) {
    canonical = `+${digits}`;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    canonical = `+234${digits.slice(1)}`;
  } else if (digits.length === 10) {
    canonical = `+234${digits}`;
  } else {
    canonical = `+${digits}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(canonical)) {
    throw new BadRequestException('Enter a valid phone number.');
  }
  return canonical;
}

export function phoneLookupCandidates(value: string) {
  const canonical = normalizePhone(value);
  if (!canonical.startsWith('+234')) return [canonical];
  const national = canonical.slice(4);
  return [canonical, `0${national}`, national, `234${national}`];
}
