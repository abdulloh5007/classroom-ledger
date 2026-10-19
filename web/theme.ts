import { flushSync } from 'react-dom';

let changing = false;

/** Reveal the new page snapshot while the old theme remains outside the circle. */
export async function revealTheme(button: HTMLElement, update: () => void): Promise<void> {
  if (changing) return;
  const root = document.documentElement;
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  changing = true;
  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  let updated = false;
  root.classList.add('theme-revealing');
  const apply = () => {
    if (updated) return;
    updated = true;
    flushSync(update);
  };
  try {
    const transition = document.startViewTransition(apply);
    // A skipped transition must never cause an unhandled rejection.
    void transition.finished.catch(() => undefined);
    await transition.ready;
    await root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      {
        duration: 540,
        easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
        pseudoElement: '::view-transition-new(root)',
      },
    ).finished;
    await transition.finished;
  } catch {
    apply();
  } finally {
    root.classList.remove('theme-revealing');
    changing = false;
  }
}
