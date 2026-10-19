export const PHONE_PREFIX = '+998 (';

export function uzPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  return (
    value.trimStart().startsWith('+998') || (digits.startsWith('998') && digits.length > 9)
      ? digits.slice(3)
      : digits
  ).slice(0, 9);
}

export function formatUzPhone(value: string): string {
  const digits = uzPhoneDigits(value);
  let result = PHONE_PREFIX + digits.slice(0, 2);
  if (digits.length >= 2) result += ') ';
  result += digits.slice(2, 5);
  if (digits.length > 5) result += '-' + digits.slice(5, 7);
  if (digits.length > 7) result += '-' + digits.slice(7, 9);
  return result;
}

export function phoneCaret(display: string, nationalDigits: number): number {
  if (nationalDigits <= 0) return PHONE_PREFIX.length;
  let count = 0;
  for (let index = PHONE_PREFIX.length; index < display.length; index++) {
    if (/\d/.test(display[index]!)) count++;
    if (count === nationalDigits) {
      let position = index + 1;
      while (position < display.length && !/\d/.test(display[position]!)) position++;
      return position;
    }
  }
  return display.length;
}
