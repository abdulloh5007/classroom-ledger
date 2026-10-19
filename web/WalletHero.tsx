import { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import type { Debtor } from '../src/contracts';
import { currentMonth, shiftMonth, monthLabel } from '../src/calendar';
import { MonthPicker } from './MonthPicker';

export function WalletHero({
  month,
  direction,
  months,
  totalStudents,
  ready,
  onMonthChange,
  onLogout,
  loggingOut,
}: {
  month: string;
  direction: number;
  months: Record<string, Debtor[]>;
  totalStudents: number;
  ready: boolean;
  onMonthChange: (month: string) => void;
  onLogout?: () => Promise<void>;
  loggingOut: boolean;
}) {
  const reduced = useReducedMotion();
  const carousel = useRef<HTMLDivElement>(null);
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
    <section className="wallet-hero" aria-label="Сводка оплат за месяц">
      {onLogout && (
        <button
          className="icon-button wallet-logout"
          aria-label="Выйти"
          disabled={loggingOut}
          onClick={() => void onLogout()}
        >
          <LogOut size={17} />
        </button>
      )}
      <MonthPicker month={month} direction={direction} onChange={onMonthChange} />
      <div className="wallet-balance-area">
        <button
          className="icon-button wallet-arrow previous"
          aria-label="Предыдущий месяц"
          disabled={month === '1900-01'}
          onClick={() => shift(-1)}
        >
          <ChevronLeft size={22} />
        </button>
        <motion.div
          ref={carousel}
          className="wallet-carousel"
          aria-roledescription="карусель"
          aria-label="Сумма и число должников по месяцам"
          style={{ touchAction: 'pan-y' }}
          onPanStart={() => {
            setDragging(true);
          }}
          onPan={(_, info) => {
            if (!reduced) setDrag(info.offset.x);
          }}
          onPointerCancel={() => {
            setDragging(false);
            setDrag(0);
          }}
          onPanEnd={(_, info) => {
            setDragging(false);
            setDrag(0);
            if (Math.abs(info.offset.x) > 45 && Math.abs(info.offset.x) > Math.abs(info.offset.y))
              shift(info.offset.x < 0 ? 1 : -1);
          }}
        >
          <AnimatePresence initial={false}>
            {slides.map(({ key, offset }) => {
              const relative = Math.abs(
                offset + drag / ((carousel.current?.clientWidth ?? 390) * 0.76 * 0.68),
              );
              const rows = key <= currentMonth() ? months[key] : undefined;
              const amount =
                rows && ready
                  ? new Intl.NumberFormat('ru-RU').format(
                      rows.reduce((sum, row) => sum + row.debt, 0),
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
                    x: `calc(${offset * 68}% + 0px)`,
                    scale: reduced ? 1 : 0.6,
                    opacity: 0,
                  }}
                  animate={{
                    x: `calc(${offset * 68}% + ${drag}px)`,
                    scale: reduced ? 1 : 1 - Math.min(relative, 1.25) * 0.4,
                    opacity:
                      relative <= 1
                        ? 1 - relative * 0.08
                        : Math.max(0, 0.92 - (relative - 1) * 1.84),
                    rotateY: reduced ? 0 : offset * -16,
                  }}
                  exit={{
                    x: `calc(${-direction * 136}% + 0px)`,
                    scale: reduced ? 1 : 0.5,
                    opacity: 0,
                  }}
                  transition={
                    reduced || dragging
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 290, damping: 32, mass: 0.85 }
                  }
                >
                  <strong
                    className={`wallet-amount${amount.length > 12 ? ' compact' : ''}`}
                    data-testid={offset === 0 ? 'wallet-amount' : undefined}
                  >
                    {amount}
                    <small>сум</small>
                  </strong>
                  <span
                    className="wallet-debtor-count"
                    data-testid={offset === 0 ? 'wallet-count' : undefined}
                  >
                    Должники <b>{rows && ready ? `${rows.length} / ${totalStudents}` : '— / —'}</b>
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
        <button
          className="icon-button wallet-arrow next"
          aria-label="Следующий месяц"
          disabled={month === '9999-11'}
          onClick={() => shift(1)}
        >
          <ChevronRight size={22} />
        </button>
      </div>
      <span className="sr-only" role="status">
        {future
          ? 'Будущий месяц: данных пока нет'
          : !months[month] || !ready
            ? 'Загрузка сводки'
            : `${monthLabel(month)}: к сбору ${months[month]!.reduce((sum, row) => sum + row.debt, 0)} сум, должников ${months[month]!.length} из ${totalStudents}`}
      </span>
    </section>
  );
}
