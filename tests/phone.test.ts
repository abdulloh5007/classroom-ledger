import { expect, it } from 'vitest';
import { formatUzPhone, PHONE_PREFIX, phoneCaret, uzPhoneDigits } from '../src/phone.js';

it('форматирует локальный и международный номер одинаково', () => {
  for (const value of ['901235678', '998901235678', '+998 90 123 56 78', '+998 (90) 123-56-78'])
    expect(formatUzPhone(value)).toBe('+998 (90) 123-56-78');
  expect(uzPhoneDigits('+998 (99) 812-34-56')).toBe('998123456');
});
it('сохраняет префикс и корректно форматирует незавершённый ввод', () => {
  expect(formatUzPhone('')).toBe(PHONE_PREFIX);
  expect(uzPhoneDigits(PHONE_PREFIX)).toBe('');
  expect(formatUzPhone('+998 (9')).toBe('+998 (9');
  expect(formatUzPhone('90')).toBe('+998 (90) ');
  expect(formatUzPhone('901235')).toBe('+998 (90) 123-5');
  expect(formatUzPhone('901235678999')).toBe('+998 (90) 123-56-78');
});
it('размещает курсор после разделителя и не позволяет стереть префикс', () => {
  const phone = formatUzPhone('901235678');
  expect(phoneCaret(phone, 0)).toBe(PHONE_PREFIX.length);
  expect(phoneCaret(phone, 2)).toBe(phone.indexOf('123'));
  expect(phoneCaret(phone, 5)).toBe(phone.indexOf('56'));
  expect(phoneCaret(phone, 9)).toBe(phone.length);
});
