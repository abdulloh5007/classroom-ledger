import { groupCaption } from './labels';
import { Marquee } from './Marquee';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeftRight, Check, Info, Plus } from 'lucide-react';
import type { Group } from '../src/contracts';
import { useI18n } from './i18n';

export function GroupMenu({
  groups,
  activeId,
  onSelect,
  onCreate,
  onStaff,
  onProfile,
  ready,
}: {
  groups: Group[];
  activeId?: number;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onStaff?: () => void;
  onProfile?: () => void;
  ready: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pending = useRef<(() => void) | null>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    held: boolean;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  const suppressClickUntil = useRef(0);
  const reduced = useReducedMotion();

  function stop() {
    clearTimeout(timer.current);
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    gesture.current = null;
    setHighlight(undefined);
  }
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  function itemAt(x: number, y: number) {
    const item = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>('[data-group-action]');
    return item && content.current?.contains(item) ? item : undefined;
  }
  function track() {
    const point = gesture.current;
    if (!point?.held) return;
    const scroll = list.current;
    if (scroll) {
      const rect = scroll.getBoundingClientRect();
      if (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top - 12 &&
        point.y <= rect.bottom + 12
      ) {
        if (point.y < rect.top + 30) scroll.scrollTop -= 7;
        else if (point.y > rect.bottom - 30) scroll.scrollTop += 7;
      }
    }
    setHighlight(itemAt(point.x, point.y)?.dataset.groupAction);
    frame.current = requestAnimationFrame(track);
  }
  function choose(value: string) {
    stop();
    if (value === 'create') pending.current = onCreate;
    else onSelect(Number(value));
    setOpen(false);
  }
  function begin(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!event.isPrimary || event.button !== 0 || !ready) return;
    suppressClickUntil.current = 0;
    stop();
    const point = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      held: false,
    };
    gesture.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    timer.current = setTimeout(() => {
      if (gesture.current !== point) return;
      point.held = true;
      pending.current = null;
      suppressClickUntil.current = Date.now() + 1000;
      setOpen(true);
      frame.current = requestAnimationFrame(track);
    }, 350);
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const point = gesture.current;
    if (!point || point.id !== event.pointerId) return;
    if (point.held) {
      event.preventDefault();
      suppressClickUntil.current = Date.now() + 600;
      const item = itemAt(event.clientX, event.clientY);
      if (item?.dataset.groupAction) choose(item.dataset.groupAction);
      else {
        const rect = event.currentTarget.getBoundingClientRect();
        const onTrigger =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        stop();
        if (!onTrigger) setOpen(false);
        else
          content.current
            ?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')
            ?.focus();
      }
    } else stop();
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) stop();
        else pending.current = null;
        setOpen(value);
      }}
    >
      <Popover.Trigger asChild>
        <button
          ref={trigger}
          className="icon-button wallet-more"
          aria-label={t('Сменить группу')}
          disabled={!ready}
          onPointerDown={begin}
          onPointerMove={(event) => {
            event.stopPropagation();
            const point = gesture.current;
            if (!point || point.id !== event.pointerId) return;
            if (
              !point.held &&
              Math.hypot(event.clientX - point.startX, event.clientY - point.startY) > 12
            ) {
              clearTimeout(timer.current);
              suppressClickUntil.current = Date.now() + 600;
            }
            point.x = event.clientX;
            point.y = event.clientY;
            if (point.held) event.preventDefault();
          }}
          onPointerUp={finish}
          onPointerCancel={() => {
            const held = gesture.current?.held;
            stop();
            if (held) setOpen(false);
          }}
          onLostPointerCapture={() => {
            if (gesture.current) {
              stop();
              setOpen(false);
            }
          }}
          onContextMenu={(event) => event.preventDefault()}
          onClickCapture={(event) => {
            if (event.detail !== 0 && Date.now() < suppressClickUntil.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <ArrowLeftRight size={21} />
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
                if (!gesture.current?.held)
                  content.current
                    ?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')
                    ?.focus();
              }}
              onCloseAutoFocus={(event) => {
                if (pending.current) event.preventDefault();
              }}
            >
              <motion.div
                ref={content}
                className="filter-popover group-menu"
                role="menu"
                aria-label={t('Сменить группу')}
                initial={{ opacity: 0, y: reduced ? 0 : -6, scale: reduced ? 1 : 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: reduced ? 0 : -4, scale: reduced ? 1 : 0.97 }}
                transition={{ duration: reduced ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] }}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    stop();
                    setOpen(false);
                    return;
                  }
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLElement>(
                      'button:not(:disabled), a[role="menuitem"]',
                    ),
                  ];
                  const index = buttons.indexOf(document.activeElement as HTMLElement);
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
                <div ref={list} className="group-menu-list">
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      role="menuitemradio"
                      aria-checked={group.id === activeId}
                      data-group-action={String(group.id)}
                      data-tracking={highlight === String(group.id) || undefined}
                      onClick={() => choose(String(group.id))}
                    >
                      <span className="group-menu-info">
                        <strong>
                          <Marquee text={group.name} />
                        </strong>
                        {groupCaption(group.name, group.courseName) !== group.name && (
                          <small>
                            <Marquee text={group.courseName} />
                          </small>
                        )}
                      </span>
                      {group.id === activeId && <Check size={17} />}
                    </button>
                  ))}
                  {!groups.length && <p className="group-menu-empty">{t('Нет групп')}</p>}
                </div>
                <button
                  role="menuitem"
                  className="group-menu-create"
                  data-group-action="create"
                  data-tracking={highlight === 'create' || undefined}
                  onClick={() => choose('create')}
                >
                  <span className="group-menu-item">
                    <Plus size={18} />
                    {t('Создать')}
                  </span>
                </button>
                {onStaff && (
                  <button
                    role="menuitem"
                    className="group-menu-about"
                    onClick={() => {
                      pending.current = onStaff;
                      setOpen(false);
                    }}
                  >
                    Сотрудники и роли
                  </button>
                )}
                {onProfile && (
                  <button
                    role="menuitem"
                    className="group-menu-about"
                    onClick={() => {
                      pending.current = onProfile;
                      setOpen(false);
                    }}
                  >
                    Мой профиль
                  </button>
                )}
                <a role="menuitem" className="group-menu-about" href="/about">
                  <Info size={18} />
                  {t('О проекте')}
                </a>
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  );
}
