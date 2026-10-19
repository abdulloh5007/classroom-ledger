import type { Currency } from './contracts.js';

export function currencyUnit(currency: Currency): string {
  return currency === 'USD' ? '$' : 'сум';
}

// All stored and API amounts are integers: sums for UZS, cents for USD.
export function parseMoneyInput(input: string, currency: Currency): number | undefined {
  const compact = input.replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
  if (!(currency === 'USD' ? /^\d+(?:\.\d{0,2})?$/ : /^\d+$/).test(compact)) return undefined;
  const [whole = '', fraction = ''] = compact.split('.');
  const amount = Number(currency === 'USD' ? whole + fraction.padEnd(2, '0') : whole);
  return Number.isSafeInteger(amount) && amount <= 1_000_000_000_000 ? amount : undefined;
}

export function moneyInput(amount: number, currency: Currency): string {
  if (currency === 'UZS') return String(amount);
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}

export function moneyNumber(amount: number, currency: Currency): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: currency === 'USD' ? 2 : 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  })
    .format(currency === 'USD' ? amount / 100 : amount)
    .replace(/[\u00a0\u202f]/g, ' ');
}

export function formatCurrency(amount: number, currency: Currency = 'UZS'): string {
  return `${moneyNumber(amount, currency)} ${currencyUnit(currency)}`;
}
