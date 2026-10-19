import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CircleHelp } from 'lucide-react';
import { useI18n } from './i18n';

export function FieldHelp({ text }: { text: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const openedByClick = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function show() {
    clearTimeout(timer.current);
    setOpen(true);
  }
  function hideSoon() {
    clearTimeout(timer.current);
    if (!pinned.current)
      timer.current = setTimeout(() => {
        if (!pinned.current) setOpen(false);
      }, 180);
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        clearTimeout(timer.current);
        if (!value) pinned.current = false;
        setOpen(value);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="icon-button field-help-trigger"
          aria-label={t('Пояснение к оплате в месяц')}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') show();
          }}
          onPointerLeave={hideSoon}
          onClick={(event) => {
            event.preventDefault();
            clearTimeout(timer.current);
            pinned.current = !pinned.current;
            openedByClick.current = pinned.current;
            setOpen(pinned.current);
          }}
        >
          <CircleHelp size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="field-help-popover"
          sideOffset={8}
          align="start"
          collisionPadding={16}
          aria-label={t('О стоимости курса')}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            if (!openedByClick.current) event.preventDefault();
            openedByClick.current = false;
          }}
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={hideSoon}
        >
          <p>{text}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
