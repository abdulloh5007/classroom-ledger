export const html = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
export const short = (value: string, size = 40): string => html(value.slice(0, size));
export const block = (...lines: string[]): string => `<blockquote>${lines.join('\n')}</blockquote>`;
export const rich = (title: string, body: string, hint?: string): string =>
  `<b>${title}</b>\n\n${body}${hint ? `\n\n${hint}` : ''}`;
export const UZS_ONLY =
  'В боте принимаются оплаты только в сумах (UZS). Оплату курса в USD внесите на сайте. Конвертации валют нет.';
