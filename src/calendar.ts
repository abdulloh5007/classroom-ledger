import { monthSchema } from './contracts.js';

// The centre operates in Uzbekistan. Date-only values never go through UTC conversion.
export function today(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function currentMonth(): string {
  return today().slice(0, 7);
}
export function shiftMonth(value: string, delta: number): string {
  monthSchema.parse(value);
  const [year, month] = value.split('-').map(Number);
  const absolute = year! * 12 + month! - 1 + delta;
  return monthSchema.parse(
    `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}`,
  );
}
export function monthRange(value: string): { start: string; end: string } {
  monthSchema.parse(value);
  const [year, month] = value.split('-').map(Number);
  const end =
    month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, '0')}-01`;
  return { start: `${value}-01`, end };
}
export const formatMoney = (amount: number): string =>
  `${new Intl.NumberFormat('ru-RU').format(amount).replace(/\u00a0/g, ' ')} сум`;
