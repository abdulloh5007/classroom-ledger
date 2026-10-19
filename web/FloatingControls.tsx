import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, Moon, Sun } from 'lucide-react';

export function FloatingControls({
  dark,
  onTheme,
  hidden,
}: {
  dark: boolean;
  onTheme: (button: HTMLButtonElement) => void;
  hidden: boolean;
}) {
  const [visible, setVisible] = useState(true);
  const [deep, setDeep] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    let previous = window.scrollY;
    let anchor = previous;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = Math.max(0, window.scrollY);
      setDeep(next > Math.max(500, window.innerHeight * 0.8));
      if (next < 60) {
        setVisible(true);
        anchor = next;
      } else if (Math.abs(next - anchor) > 9) {
        setVisible(next < previous);
        anchor = next;
      }
      previous = next;
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', scroll, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', scroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  const transition = { duration: reduced ? 0 : 0.34, ease: [0.32, 0.72, 0, 1] as const };
  return (
    <AnimatePresence>
      {visible && !hidden && (
        <motion.button
          key="theme"
          className="icon-button floating-control floating-theme"
          initial={{ y: reduced ? 0 : 128, opacity: reduced ? 0 : 1 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: reduced ? 0 : 128, opacity: reduced ? 0 : 1 }}
          whileTap={{ scale: reduced ? 1 : 0.94 }}
          transition={transition}
          aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
          onClick={(event) => onTheme(event.currentTarget)}
        >
          {dark ? <Sun size={20} /> : <Moon size={20} />}
        </motion.button>
      )}
      {visible && deep && !hidden && (
        <motion.button
          key="top"
          className="icon-button floating-control floating-top"
          initial={{ y: reduced ? 0 : 128, opacity: reduced ? 0 : 1 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: reduced ? 0 : 128, opacity: reduced ? 0 : 1 }}
          whileTap={{ scale: reduced ? 1 : 0.94 }}
          transition={transition}
          aria-label="Вернуться наверх"
          onClick={() => window.scrollTo({ top: 0, behavior: reduced ? 'instant' : 'smooth' })}
        >
          <ArrowUp size={20} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
