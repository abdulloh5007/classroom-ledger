import { useId, useLayoutEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, X } from 'lucide-react';
import { currentMonth, monthLabel } from '../src/calendar';

const ROW = 44;
const monthNames = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, index, 1)),
  ),
);
function Wheel({
  label,
  value,
  min,
  max,
  format = String,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const reported = useRef<number | undefined>(undefined);
  const [position, setPosition] = useState(value - min);
  const reduced = useReducedMotion();
  const count = max - min + 1;
  useLayoutEffect(() => {
    if (reported.current === value) return;
    reported.current = value;
    const index = value - min;
    if (container.current) {
      const element = container.current;
      // Virtual rows near the old year must not pull a distant jump back via scroll-snap.
      element.style.scrollSnapType = 'none';
      element.scrollTop = index * ROW;
      requestAnimationFrame(() => {
        if (element.isConnected) element.style.scrollSnapType = '';
      });
    }
    setPosition(index);
  }, [value, min]);
  function move(index: number) {
    const target = Math.max(0, Math.min(count - 1, index));
    if (Math.abs(target - position) > 5 && container.current) {
      const element = container.current;
      element.style.scrollSnapType = 'none';
      setPosition(target);
      reported.current = target + min;
      onChange(target + min);
      element.scrollTop = target * ROW;
      requestAnimationFrame(() => {
        if (element.isConnected) element.style.scrollSnapType = '';
      });
      return;
    }
    container.current?.scrollTo({
      top: target * ROW,
      behavior: reduced ? 'instant' : 'smooth',
    });
  }
  const center = Math.max(0, Math.min(count - 1, Math.round(position)));
  const start = Math.max(0, center - 7);
  const end = Math.min(count - 1, center + 7);
  return (
    <div className="wheel-column">
      <span className="wheel-label" id={`${id}-label`}>
        {label}
      </span>
      <div
        className="wheel"
        ref={container}
        role="listbox"
        tabIndex={0}
        aria-labelledby={`${id}-label`}
        aria-activedescendant={`${id}-${center}`}
        onScroll={(event) => {
          const next = event.currentTarget.scrollTop / ROW;
          setPosition(next);
          const selected = Math.max(min, Math.min(max, min + Math.round(next)));
          if (reported.current !== selected) {
            reported.current = selected;
            onChange(selected);
          }
        }}
        onKeyDown={(event) => {
          const offsets: Record<string, number> = {
            ArrowUp: -1,
            ArrowDown: 1,
            PageUp: -12,
            PageDown: 12,
          };
          if (event.key in offsets || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            move(
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? count - 1
                  : center + offsets[event.key]!,
            );
          }
        }}
      >
        <div className="wheel-track" style={{ height: (count + 4) * ROW }}>
          {Array.from({ length: end - start + 1 }, (_, index) => start + index).map((index) => {
            const distance = index - position;
            return (
              <div
                key={index}
                id={`${id}-${index}`}
                className="wheel-option"
                role="option"
                aria-selected={index === center}
                aria-posinset={index + 1}
                aria-setsize={count}
                style={{ top: (index + 2) * ROW }}
                onClick={() => move(index)}
              >
                <span
                  style={{
                    transform: reduced
                      ? undefined
                      : `rotateX(${Math.max(-65, Math.min(65, distance * 20))}deg)`,
                    opacity: Math.max(0.62, 1 - Math.abs(distance) * 0.18),
                  }}
                >
                  {format(min + index)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MonthPicker({
  month,
  direction,
  onChange,
}: {
  month: string;
  direction: number;
  onChange: (month: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [number, setNumber] = useState(Number(month.slice(5)));
  const reduced = useReducedMotion();
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setYear(Number(month.slice(0, 4)));
          setNumber(Number(month.slice(5)));
        }
        setOpen(value);
      }}
      modal
    >
      <Popover.Trigger className="wallet-month" aria-label={`Выбрать месяц: ${monthLabel(month)}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={month}
            className="month-label"
            initial={{ opacity: 0, x: reduced ? 0 : direction * 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduced ? 0 : direction * -8 }}
            transition={{ duration: reduced ? 0 : 0.16 }}
          >
            {monthLabel(month)}
          </motion.span>
        </AnimatePresence>
        <ChevronDown size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="month-popover"
          side="bottom"
          sideOffset={10}
          collisionPadding={16}
          aria-label="Выбор месяца и года"
        >
          <div className="month-picker-header">
            <strong>Выбрать месяц</strong>
            <Popover.Close className="icon-button" aria-label="Закрыть выбор месяца">
              <X size={18} />
            </Popover.Close>
          </div>
          <div className="month-wheels">
            <span className="wheel-selection" aria-hidden="true" />
            <Wheel
              label="Месяц"
              value={number}
              min={1}
              max={year === 9999 ? 11 : 12}
              format={(value) => monthNames[value - 1]!}
              onChange={setNumber}
            />
            <Wheel
              label="Год"
              value={year}
              min={1900}
              max={9999}
              onChange={(value) => {
                setYear(value);
                if (value === 9999 && number === 12) setNumber(11);
              }}
            />
          </div>
          <div className="month-picker-actions">
            <button
              className="button secondary"
              onClick={() => {
                const now = currentMonth();
                setYear(Number(now.slice(0, 4)));
                setNumber(Number(now.slice(5)));
              }}
            >
              Текущий
            </button>
            <button
              className="button primary"
              onClick={() => {
                onChange(`${year}-${String(number).padStart(2, '0')}`);
                setOpen(false);
              }}
            >
              Готово
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
