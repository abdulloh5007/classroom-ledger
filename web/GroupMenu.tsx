import { useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeftRight, MoreVertical, Plus } from 'lucide-react';
import { useI18n } from './i18n';

export function GroupMenu({
  onCreate,
  onSwitch,
  ready,
  canSwitch,
}: {
  onCreate: () => void;
  onSwitch: () => void;
  ready: boolean;
  canSwitch: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pending = useRef<(() => void) | null>(null);
  const skipRestore = useRef(false);
  const reduced = useReducedMotion();
  function choose(action: () => void) {
    skipRestore.current = true;
    pending.current = action;
    setOpen(false);
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (value) {
          skipRestore.current = false;
          pending.current = null;
        }
        setOpen(value);
      }}
    >
      <Popover.Trigger asChild>
        <button
          ref={trigger}
          className="icon-button wallet-more"
          aria-label={t('Меню группы')}
          disabled={!ready}
        >
          <MoreVertical size={21} />
        </button>
      </Popover.Trigger>
      <AnimatePresence
        onExitComplete={() => {
          const action = pending.current;
          pending.current = null;
          if (action) {
            trigger.current?.focus();
            action();
          }
        }}
      >
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
                content.current?.querySelector<HTMLButtonElement>('button')?.focus();
              }}
              onCloseAutoFocus={(event) => {
                if (skipRestore.current) event.preventDefault();
              }}
            >
              <motion.div
                ref={content}
                className="filter-popover group-menu"
                role="menu"
                aria-label={t('Меню группы')}
                initial={{ opacity: 0, y: reduced ? 0 : -6, scale: reduced ? 1 : 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: reduced ? 0 : -4, scale: reduced ? 1 : 0.97 }}
                transition={{ duration: reduced ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] }}
                onKeyDown={(event) => {
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      'button:not(:disabled)',
                    ),
                  ];
                  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  buttons[
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                          buttons.length
                  ]?.focus();
                }}
              >
                <button role="menuitem" onClick={() => choose(onCreate)}>
                  <span className="group-menu-item">
                    <Plus size={18} />
                    {t('Создать группу')}
                  </span>
                </button>
                <button role="menuitem" disabled={!canSwitch} onClick={() => choose(onSwitch)}>
                  <span className="group-menu-item">
                    <ArrowLeftRight size={18} />
                    {t('Сменить группу')}
                  </span>
                </button>
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  );
}
