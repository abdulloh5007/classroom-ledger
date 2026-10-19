import type { Currency } from '../src/contracts';
import { currencyUnit } from '../src/money';
import { useI18n } from './i18n';
import { useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, X, LoaderCircle } from 'lucide-react';

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={8}>
          {label}
          <Tooltip.Arrow />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
export function Spinner() {
  return <LoaderCircle className="spinner" size={18} aria-hidden="true" />;
}
export function Sheet({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();

  const controls = useDragControls();
  const returnFocus = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              onOpenAutoFocus={() => {
                returnFocus.current =
                  document.activeElement instanceof HTMLElement ? document.activeElement : null;
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (returnFocus.current?.isConnected) returnFocus.current.focus();
                else document.querySelector<HTMLButtonElement>('.wallet-more')?.focus();
              }}
            >
              <motion.section
                className="sheet"
                drag={reduced ? false : 'y'}
                dragListener={false}
                dragControls={controls}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 90 || info.velocity.y > 650) onClose();
                }}
                initial={{ y: reduced ? 0 : '100%', opacity: reduced ? 0 : 1 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: reduced ? 0 : '100%', opacity: reduced ? 0 : 1 }}
                transition={{
                  type: 'spring',
                  stiffness: 420,
                  damping: 32,
                  duration: reduced ? 0 : undefined,
                }}
              >
                <div
                  className="drag-zone"
                  onPointerDown={(event) => controls.start(event)}
                  aria-hidden="true"
                >
                  <span />
                </div>
                <header className="sheet-header">
                  <div>
                    <Dialog.Title>{title}</Dialog.Title>
                    <Dialog.Description className={description ? undefined : 'sr-only'}>
                      {description || title}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close className="icon-button" aria-label={t('Закрыть')}>
                    <X size={20} />
                  </Dialog.Close>
                </header>
                <div className="sheet-body">{children}</div>
              </motion.section>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
export function StudentSelect({
  value,
  onChange,
  options,
  disabled,
  error,
  id = 'student-select',
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}) {
  const { t } = useI18n();

  return (
    <>
      <label className="field-label" id={`${id}-label`}>
        {label ?? t('Ученик')}{' '}
      </label>
      <Select.Root value={value} onValueChange={onChange} disabled={disabled} required>
        <Select.Trigger
          className="select-trigger"
          aria-labelledby={`${id}-label`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <Select.Value placeholder={placeholder ?? t('Выберите ученика')} />
          <Select.Icon>
            <ChevronDown className="select-chevron" size={17} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            className="select-content"
            aria-labelledby={`${id}-label`}
            position="popper"
            sideOffset={6}
            collisionPadding={16}
          >
            <Select.ScrollUpButton className="select-scroll">↑</Select.ScrollUpButton>
            <Select.Viewport className="select-viewport">
              {options.map((option) => (
                <Select.Item className="select-item" key={option.value} value={option.value}>
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check size={16} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="select-scroll">↓</Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {t(error)}
        </span>
      )}
    </>
  );
}
export function AmountField({
  id,
  label,
  value,
  onChange,
  error,
  max,
  onMax,
  disabled,
  currency = 'UZS',
}: {
  currency?: Currency;
  id: string;
  max?: number;
  disabled?: boolean;
  onMax?: () => void;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const { t } = useI18n();

  const [whole = '', fraction] = value.split(/[.,]/);
  const display =
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (fraction === undefined ? '' : ',' + fraction);
  return (
    <div className="field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <div className={`amount-input${onMax ? ' with-max' : ''}`}>
        <input
          id={id}
          disabled={disabled}
          aria-labelledby={`${id}-label`}
          name={id}
          inputMode={currency === 'USD' ? 'decimal' : 'numeric'}
          autoComplete="off"
          value={display}
          onChange={(event) => {
            const next = event.target.value.replace(/\s/g, '');
            if ((currency === 'USD' ? /^\d*(?:[.,]\d{0,2})?$/ : /^\d*$/).test(next)) onChange(next);
          }}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder="0"
        />
        {onMax ? (
          <button
            className="amount-max"
            type="button"
            onClick={onMax}
            disabled={!max}
            aria-label={t('Внести весь остаток')}
          >
            MAX
          </button>
        ) : (
          <span>{t(currencyUnit(currency))}</span>
        )}
      </div>
      {error && (
        <span id={`${id}-error`} className="field-error">
          {t(error)}
        </span>
      )}
    </div>
  );
}
export function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <motion.div className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </motion.div>
  );
}

export function ConfirmDelete({
  open,
  busy,
  error,
  description,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const cancel = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onCancel();
      }}
    >
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="overlay confirm-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              asChild
              role="alertdialog"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                returnFocus.current =
                  document.activeElement instanceof HTMLElement ? document.activeElement : null;
                cancel.current?.focus();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (returnFocus.current?.isConnected) returnFocus.current.focus();
                else document.querySelector<HTMLButtonElement>('.wallet-more')?.focus();
              }}
              onEscapeKeyDown={(event) => {
                if (busy) event.preventDefault();
              }}
              onPointerDownOutside={(event) => {
                if (busy) event.preventDefault();
              }}
            >
              <motion.div
                className="confirm-dialog"
                initial={{ opacity: 0, scale: reduced ? 1 : 0.94, y: reduced ? 0 : 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: reduced ? 1 : 0.96, y: reduced ? 0 : 6 }}
                transition={{ duration: reduced ? 0 : 0.22, ease: [0.32, 0.72, 0, 1] }}
              >
                <Dialog.Title>{t('Действия необратимы. Вы согласны?')}</Dialog.Title>
                <Dialog.Description className="sr-only">{description}</Dialog.Description>
                {error && (
                  <p className="error-message" role="alert">
                    {t(error)}
                  </p>
                )}
                <div className="confirm-actions">
                  <button
                    ref={cancel}
                    className="button secondary"
                    disabled={busy}
                    onClick={onCancel}
                  >
                    {t('Отмена')}
                  </button>
                  <button className="button destructive" disabled={busy} onClick={onConfirm}>
                    {busy ? <Spinner /> : null}
                    {t('Удалить всё')}
                  </button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
