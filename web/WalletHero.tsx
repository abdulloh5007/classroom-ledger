import { Pencil } from 'lucide-react';
import { Marquee } from './Marquee';
import { currencyUnit, moneyNumber } from '../src/money';
import { useI18n } from './i18n';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Currency, Group, Debtor } from '../src/contracts';
import { currentMonth, shiftMonth } from '../src/calendar';
import { MonthPicker } from './MonthPicker';
import { GroupMenu } from './GroupMenu';

export const WalletHero = memo(function WalletHero({
  month,
  direction,
  months,
  totalStudents,
  ready,
  onMonthChange,
  groupName,
  onCreateGroup,
  onEditGroup,
  onSelectGroup,
  groups,
  groupId,
  currency,
}: {
  month: string;
  direction: number;
  months: Record<string, Debtor[]>;
  totalStudents: number;
  ready: boolean;
  onMonthChange: (month: string) => void;
  groupName: string;
  onCreateGroup: () => void;
  onEditGroup: () => void;
  onSelectGroup: (id: number) => void;
  groups: Group[];
  groupId?: number;
  currency: Currency;
}) {
  const { t, monthLabel, formatMoney } = useI18n();

  const reduced = useReducedMotion();
  const carousel = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const ignorePan = useRef(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const future = month > currentMonth();
  const slides = [-2, -1, 0, 1, 2].flatMap((offset) => {
    try {
      return [{ offset, key: shiftMonth(month, offset) }];
    } catch {
      return [];
    }
  });
  function shift(delta: number) {
    try {
      onMonthChange(shiftMonth(month, delta));
    } catch {
      /* Calendar boundary. */
    }
  }
  return (
    <motion.section
      className="wallet-hero"
      aria-label={t('Сводка оплат за месяц')}
      style={{ touchAction: 'pan-y' }}
      onPointerDownCapture={(event) => {
        const control =
          event.target instanceof Element ? event.target.closest('button, [role="menu"]') : null;
        ignorePan.current = Boolean(control && !control.classList.contains('wallet-edge'));
        moved.current = false;
      }}
      onPanStart={() => {
        if (!ignorePan.current) setDragging(true);
      }}
      onPan={(_, info) => {
        if (ignorePan.current) return;
        if (Math.hypot(info.offset.x, info.offset.y) > 8) moved.current = true;
        if (!reduced) setDrag(info.offset.x);
      }}
      onPointerCancel={() => {
        setDragging(false);
        setDrag(0);
        moved.current = true;
      }}
      onPanEnd={(_, info) => {
        if (ignorePan.current) return;
        setDragging(false);
        setDrag(0);
        if (Math.abs(info.offset.x) > 45 && Math.abs(info.offset.x) > Math.abs(info.offset.y)) {
          moved.current = true;
          shift(info.offset.x < 0 ? 1 : -1);
        }
      }}
    >
      <GroupMenu
        onCreate={onCreateGroup}
        onSelect={onSelectGroup}
        groups={groups}
        activeId={groupId}
        ready={ready}
      />
      <div className="hero-top-row">
        <MonthPicker month={month} direction={direction} onChange={onMonthChange} />
      </div>
      <p className="wallet-group-name" title={groupName}>
        <Marquee text={ready ? groupName || t('Нет групп') : t('Загрузка…')} />
        {ready && groupId && (
          <button
            className="icon-button group-edit-button"
            aria-label={t('Изменить группу')}
            onClick={onEditGroup}
          >
            <Pencil size={14} />
          </button>
        )}
      </p>
      <div className="wallet-balance-area">
        <motion.div
          ref={carousel}
          className="wallet-carousel"
          aria-roledescription={t('карусель')}
          aria-label={t('Сумма и число должников по месяцам')}
        >
          <AnimatePresence initial={false}>
            {slides.map(({ key, offset }) => {
              const relative = Math.abs(
                offset + drag / ((carousel.current?.clientWidth ?? 390) * 0.76 * 0.75),
              );
              const rows =
                key <= currentMonth() ? months[key]?.filter((row) => row.debt > 0) : undefined;
              const amount =
                rows && ready
                  ? moneyNumber(
                      rows.reduce((sum, row) => sum + row.debt, 0),
                      currency,
                    )
                  : '—';
              return (
                <motion.div
                  key={key}
                  className="wallet-balance-slide"
                  data-month={key}
                  aria-hidden={offset !== 0}
                  role="group"
                  aria-label={monthLabel(key)}
                  initial={{
                    x: `calc(${offset * 75}% + 0px)`,
                    scale: reduced ? 1 : 0.6,
                    opacity: 0,
                  }}
                  animate={{
                    x: `calc(${offset * 75}% + ${drag}px)`,
                    scale: reduced ? 1 : 1 - Math.min(relative, 1.25) * 0.4,
                    opacity:
                      relative <= 1
                        ? 1 - relative * 0.08
                        : Math.max(0, 0.92 - (relative - 1) * 1.84),
                  }}
                  exit={{
                    x: `calc(${-direction * 150}% + 0px)`,
                    scale: reduced ? 1 : 0.5,
                    opacity: 0,
                  }}
                  transition={
                    reduced || dragging
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 290, damping: 32, mass: 0.85 }
                  }
                >
                  <FittedAmount amount={amount} active={offset === 0} currency={currency} />
                  <span
                    className="wallet-debtor-count"
                    data-testid={offset === 0 ? 'wallet-count' : undefined}
                  >
                    {t('Должники')}{' '}
                    <b>{rows && ready ? `${rows.length} / ${totalStudents}` : '— / —'}</b>
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </div>
      {([-1, 1] as const).map((delta) => (
        <button
          key={delta}
          className={`wallet-edge ${delta < 0 ? 'previous' : 'next'}`}
          aria-label={delta < 0 ? t('Предыдущий месяц') : t('Следующий месяц')}
          disabled={month === (delta < 0 ? '1900-01' : '9999-11')}
          onClick={(event) => {
            if (!moved.current || event.detail === 0) shift(delta);
          }}
        />
      ))}
      <span className="sr-only" role="status">
        {future
          ? t('Будущий месяц: данных пока нет')
          : !months[month] || !ready
            ? t('Загрузка сводки')
            : `${monthLabel(month)}: ${formatMoney(
                months[month]!.reduce((sum, row) => sum + row.debt, 0),
                currency,
              )}, ${t('Должники')} ${months[month]!.filter((row) => row.debt > 0).length} / ${totalStudents}`}
      </span>
    </motion.section>
  );
});

function FittedAmount({
  amount,
  active,
  currency,
}: {
  amount: string;
  active: boolean;
  currency: Currency;
}) {
  const { t, language } = useI18n();

  const element = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const text = element.current;
    const container = text?.parentElement;
    if (!text || !container) return;
    const fit = () => {
      text.style.fontSize = '';
      const style = getComputedStyle(text);
      const base = parseFloat(style.fontSize);
      const available = container.clientWidth * 0.94;
      const digits = text.firstElementChild as HTMLElement;
      const suffix = text.lastElementChild as HTMLElement;
      const gap = parseFloat(style.columnGap) || 0;
      // Measure untransformed children: a centred overflowing flex row hides
      // part of its width from scrollWidth, and neighbours are scaled down.
      const width = digits.scrollWidth;
      const space = available - suffix.offsetWidth - gap;
      if (width > space)
        text.style.fontSize = `${Math.max(14, Math.floor((base * space) / width))}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [amount, language, currency]);
  return (
    <strong
      ref={element}
      className="wallet-amount"
      data-testid={active ? 'wallet-amount' : undefined}
    >
      <span>{amount}</span>
      <small>{t(currencyUnit(currency))}</small>
    </strong>
  );
}
