import { useI18n } from './i18n';
import { useLayoutEffect, useRef } from 'react';
import { formatUzPhone, PHONE_PREFIX, phoneCaret, uzPhoneDigits } from '../src/phone';

export function PhoneField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const { t } = useI18n();

  const input = useRef<HTMLInputElement>(null);
  const desiredCaret = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (
      desiredCaret.current !== undefined &&
      input.current &&
      document.activeElement === input.current
    ) {
      input.current.setSelectionRange(desiredCaret.current, desiredCaret.current);
      desiredCaret.current = undefined;
    }
  }, [value]);
  function update(raw: string, digitsBefore?: number) {
    const display = formatUzPhone(raw);
    const caret = digitsBefore === undefined ? display.length : phoneCaret(display, digitsBefore);
    desiredCaret.current = caret;
    onChange(display);
    if (display === value && input.current) {
      input.current.value = display;
      input.current.setSelectionRange(caret, caret);
      desiredCaret.current = undefined;
    }
  }
  return (
    <label className="field" htmlFor="student-phone">
      <span id="student-phone-label">{t('Телефон')}</span>
      <input
        ref={input}
        id="student-phone"
        name="phone"
        aria-labelledby="student-phone-label"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        required
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'phone-error' : undefined}
        onFocus={(event) => {
          if ((event.target.selectionStart ?? 0) < PHONE_PREFIX.length)
            event.target.setSelectionRange(value.length, value.length);
        }}
        onClick={(event) => {
          const element = event.currentTarget;
          if (
            element.selectionStart === element.selectionEnd &&
            (element.selectionStart ?? 0) < PHONE_PREFIX.length
          )
            element.setSelectionRange(PHONE_PREFIX.length, PHONE_PREFIX.length);
        }}
        onPaste={(event) => {
          const digits = event.clipboardData.getData('text').replace(/\D/g, '');
          if (digits.length === 9 || (digits.startsWith('998') && digits.length === 12)) {
            event.preventDefault();
            update(digits);
          }
        }}
        onKeyDown={(event) => {
          const element = event.currentTarget;
          const start = element.selectionStart ?? value.length;
          const end = element.selectionEnd ?? start;
          if (event.key === 'Home' && !event.shiftKey) {
            event.preventDefault();
            element.setSelectionRange(PHONE_PREFIX.length, PHONE_PREFIX.length);
          }
          if (!['Backspace', 'Delete'].includes(event.key) || event.metaKey || event.ctrlKey)
            return;
          event.preventDefault();
          const digits = uzPhoneDigits(value);
          const before = value
            .slice(PHONE_PREFIX.length, Math.max(PHONE_PREFIX.length, start))
            .replace(/\D/g, '').length;
          const through = value
            .slice(PHONE_PREFIX.length, Math.max(PHONE_PREFIX.length, end))
            .replace(/\D/g, '').length;
          if (start !== end) update(digits.slice(0, before) + digits.slice(through), before);
          else if (event.key === 'Backspace' && before > 0)
            update(digits.slice(0, before - 1) + digits.slice(before), before - 1);
          else if (event.key === 'Delete')
            update(digits.slice(0, before) + digits.slice(before + 1), before);
        }}
        onChange={(event) => {
          const raw = event.target.value;
          const caret = event.target.selectionStart ?? raw.length;
          const before = raw.slice(0, caret).replace(/\D/g, '').length;
          const hasPrefix = raw.startsWith('+998');
          update(raw, Math.max(0, before - (hasPrefix ? 3 : 0)));
        }}
      />
      {error && (
        <span id="phone-error" className="field-error">
          {t(error)}
        </span>
      )}
    </label>
  );
}
