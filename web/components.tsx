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
                returnFocus.current?.focus();
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
                    <Dialog.Description>{description}</Dialog.Description>
                  </div>
                  <Dialog.Close className="icon-button" aria-label="Закрыть">
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
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  error?: string;
}) {
  return (
    <>
      <label className="field-label" id="student-select-label">
        Ученик
      </label>
      <Select.Root value={value} onValueChange={onChange} disabled={disabled} required>
        <Select.Trigger
          className="select-trigger"
          aria-labelledby="student-select-label"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'student-select-error' : undefined}
        >
          <Select.Value placeholder="Выберите ученика" />
          <Select.Icon>
            <ChevronDown className="select-chevron" size={17} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            className="select-content"
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
        <span className="field-error" id="student-select-error">
          {error}
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
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const display = value.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (
    <label className="field" htmlFor={id}>
      <span id={`${id}-label`}>{label}</span>
      <div className="amount-input">
        <input
          id={id}
          aria-labelledby={`${id}-label`}
          name={id}
          inputMode="numeric"
          autoComplete="off"
          value={display}
          onChange={(event) => {
            if (/^[\d\s]*$/.test(event.target.value))
              onChange(event.target.value.replace(/\s/g, ''));
          }}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder="0"
        />
        <span>сум</span>
      </div>
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </label>
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
