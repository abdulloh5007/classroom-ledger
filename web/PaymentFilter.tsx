import { useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, SlidersHorizontal } from 'lucide-react';

export type PaymentStatus = 'paid' | 'unpaid' | 'partial';
const options = [
  { value: 'unpaid', label: 'Не оплатившие', hint: 'Пока нет оплат' },
  { value: 'partial', label: 'В процессе', hint: 'Внесена часть суммы' },
  { value: 'paid', label: 'Оплатившие', hint: 'Сумма внесена полностью' },
] as const;

export function PaymentFilter({
  value,
  onChange,
}: {
  value: PaymentStatus;
  onChange: (value: PaymentStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="icon-button payment-filter"
          aria-label={`Фильтр оплат: ${options.find((option) => option.value === value)!.label}`}
        >
          <SlidersHorizontal size={19} />
          {value !== 'unpaid' && <span className="filter-dot" />}
        </button>
      </Popover.Trigger>
      <AnimatePresence>
        {open && (
          <Popover.Portal forceMount>
            <Popover.Content
              forceMount
              asChild
              sideOffset={8}
              align="end"
              collisionPadding={16}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                content.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
              }}
            >
              <motion.div
                ref={content}
                className="filter-popover"
                role="menu"
                aria-label="Показать по статусу оплаты"
                initial={{ opacity: 0, y: reduced ? 0 : -6, scale: reduced ? 1 : 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: reduced ? 0 : -4, scale: reduced ? 1 : 0.97 }}
                transition={{ duration: reduced ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] }}
                onKeyDown={(event) => {
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      '[role="menuitemradio"]',
                    ),
                  ];
                  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                          buttons.length;
                  buttons[next]?.focus();
                }}
              >
                <span className="filter-caption">Показать по</span>
                {options.map((option) => (
                  <button
                    key={option.value}
                    role="menuitemradio"
                    aria-checked={value === option.value}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </span>
                    {value === option.value && <Check size={17} />}
                  </button>
                ))}
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  );
}
