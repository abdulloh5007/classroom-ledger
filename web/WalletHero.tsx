import { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LogOut } from 'lucide-react';
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
  const moved = useRef(false);
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
      aria-label="Сводка оплат за месяц"
      style={{ touchAction: 'pan-y' }}
      onPointerDownCapture={() => {
        moved.current = false;
      }}
      onPanStart={() => setDragging(true)}
      onPan={(_, info) => {
        if (Math.hypot(info.offset.x, info.offset.y) > 8) moved.current = true;
        if (!reduced) setDrag(info.offset.x);
      }}
      onPointerCancel={() => {
        setDragging(false);
        setDrag(0);
        moved.current = true;
      }}
      onPanEnd={(_, info) => {
        setDragging(false);
        setDrag(0);
        if (Math.abs(info.offset.x) > 45 && Math.abs(info.offset.x) > Math.abs(info.offset.y)) {
          moved.current = true;
          shift(info.offset.x < 0 ? 1 : -1);
        }
      }}
    >
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
        <motion.div
          ref={carousel}
          className="wallet-carousel"
          aria-roledescription="карусель"
          aria-label="Сумма и число должников по месяцам"
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
                    rotateY: reduced ? 0 : offset * -16,
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
      </div>
      {([-1, 1] as const).map((delta) => (
        <button
          key={delta}
          className={`wallet-edge ${delta < 0 ? 'previous' : 'next'}`}
          aria-label={delta < 0 ? 'Предыдущий месяц' : 'Следующий месяц'}
          disabled={month === (delta < 0 ? '1900-01' : '9999-11')}
          onClick={(event) => {
            if (!moved.current || event.detail === 0) shift(delta);
          }}
        />
      ))}
      <span className="sr-only" role="status">
        {future
          ? 'Будущий месяц: данных пока нет'
          : !months[month] || !ready
            ? 'Загрузка сводки'
            : `${monthLabel(month)}: к сбору ${months[month]!.reduce((sum, row) => sum + row.debt, 0)} сум, должников ${months[month]!.filter((row) => row.debt > 0).length} из ${totalStudents}`}
      </span>
    </motion.section>
  );
}
