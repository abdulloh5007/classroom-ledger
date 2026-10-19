import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
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
  resetVersion,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  resetVersion: number;
}) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const reported = useRef<number | undefined>(undefined);
  const lastReset = useRef(resetVersion);
  const animation = useRef({ frame: 0, programmatic: false });
  const [position, setPosition] = useState(value - min);
  const reduced = useReducedMotion();
  const count = max - min + 1;
  useEffect(() => {
    const state = animation.current;
    const element = container.current;
    return () => {
      cancelAnimationFrame(state.frame);
      state.programmatic = false;
      if (element) element.style.scrollSnapType = '';
    };
  }, []);
  function stopAnimation() {
    cancelAnimationFrame(animation.current.frame);
    animation.current.programmatic = false;
    if (container.current) container.current.style.scrollSnapType = '';
  }
  useLayoutEffect(() => {
    const reset = lastReset.current !== resetVersion;
    lastReset.current = resetVersion;
    if (reported.current === value && !reset) return;
    reported.current = value;
    const index = value - min;
    if (container.current) {
      const element = container.current;
      const state = animation.current;
      cancelAnimationFrame(state.frame);
      state.programmatic = false;
      element.style.scrollSnapType = 'none';
      const target = index * ROW;
      const restoreSnap = () => {
        if (element.isConnected) element.style.scrollSnapType = '';
      };
      if (reset && !reduced && Math.abs(element.scrollTop - target) > 0.5) {
        const from = element.scrollTop;
        const started = performance.now();
        state.programmatic = true;
        const tick = (now: number) => {
          const progress = Math.min(1, (now - started) / 420);
          const eased = 1 - Math.pow(1 - progress, 4);
          const top = from + (target - from) * eased;
          element.scrollTop = top;
          setPosition(top / ROW);
          if (progress < 1) state.frame = requestAnimationFrame(tick);
          else {
            state.programmatic = false;
            state.frame = requestAnimationFrame(restoreSnap);
          }
        };
        state.frame = requestAnimationFrame(tick);
        return;
      }
      element.scrollTop = target;
      state.frame = requestAnimationFrame(restoreSnap);
    }
    setPosition(index);
  }, [value, min, resetVersion, reduced]);
  function move(index: number) {
    const target = Math.max(0, Math.min(count - 1, index));
    if (Math.abs(target - position) > 5 && container.current) {
      const element = container.current;
      element.style.scrollSnapType = 'none';
      setPosition(target);
      reported.current = target + min;
      onChange(target + min);
      element.scrollTop = target * ROW;
      animation.current.frame = requestAnimationFrame(() => {
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
      <div
        className="wheel"
        ref={container}
        role="listbox"
        tabIndex={0}
        aria-label={label}
        aria-activedescendant={`${id}-${center}`}
        onScroll={(event) => {
          const next = event.currentTarget.scrollTop / ROW;
          setPosition(next);
          if (animation.current.programmatic) return;
          const selected = Math.max(min, Math.min(max, min + Math.round(next)));
          if (reported.current !== selected) {
            reported.current = selected;
            onChange(selected);
          }
        }}
        onKeyDown={(event) => {
          stopAnimation();
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
        onPointerDown={stopAnimation}
        onWheelCapture={stopAnimation}
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
  const [resetVersion, setResetVersion] = useState(0);
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
        <ChevronDown size={14} className="month-chevron" />
      </Popover.Trigger>
      <AnimatePresence>
        {open && (
          <Popover.Portal forceMount>
            <Popover.Content
              forceMount
              asChild
              side="bottom"
              sideOffset={10}
              collisionPadding={16}
              aria-label="Выбор месяца и года"
            >
              <motion.div
                className="month-popover"
                initial={{ opacity: 0, y: reduced ? 0 : -8, scale: reduced ? 1 : 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: reduced ? 0 : -6, scale: reduced ? 1 : 0.97 }}
                transition={{ duration: reduced ? 0 : 0.28, ease: [0.32, 0.72, 0, 1] }}
              >
                <div className="month-wheels">
                  <span className="wheel-selection" aria-hidden="true" />
                  <Wheel
                    label="Месяц"
                    value={number}
                    min={1}
                    max={year === 9999 ? 11 : 12}
                    format={(value) => monthNames[value - 1]!}
                    onChange={setNumber}
                    resetVersion={resetVersion}
                  />
                  <Wheel
                    label="Год"
                    value={year}
                    min={1900}
                    max={9999}
                    resetVersion={resetVersion}
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
                      setResetVersion((value) => value + 1);
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
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  );
}
