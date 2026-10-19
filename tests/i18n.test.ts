import { afterEach, expect, it, vi } from 'vitest';
import { localizedMonth, money, setLanguage, t } from '../web/i18n';
afterEach(() => {
  setLanguage('ru');
  vi.unstubAllGlobals();
});
it('переводит интерфейс и деньги на узбекский и возвращает русский', () => {
  setLanguage('uz');
  expect(t('Внести оплату')).toBe('To‘lov kiritish');
  expect(t('После оплаты')).toBe('To‘lovdan so‘ng');
  expect(money(1250000)).toBe('1 250 000 so‘m');
  expect(localizedMonth('2026-10')).toContain('oktabr');
  setLanguage('ru');
  expect(t('Внести оплату')).toBe('Внести оплату');
  expect(money(1250000)).toBe('1 250 000 сум');
});
it('сохраняет выбранный язык и не изменяет произвольные пользовательские строки', () => {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { setItem });
  setLanguage('uz');
  expect(setItem).toHaveBeenCalledWith('ledger-language', 'uz');
  expect(t('Frontend · A2')).toBe('Frontend · A2');
});
