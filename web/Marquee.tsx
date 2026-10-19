import { useLayoutEffect, useRef, useState } from 'react';

export function Marquee({ text }: { text: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const original = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const box = viewport.current;
    const row = track.current;
    const label = original.current;
    if (!box || !row || !label) return;
    let animation: Animation | undefined;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const fit = () => {
      animation?.cancel();
      const overflowing = label.scrollWidth > box.clientWidth + 1;
      setOverflow(overflowing);
      if (!overflowing || media.matches) return;
      const distance = label.offsetWidth + 32;
      const duration = distance / 32 + 3;
      // The duplicate arrives at exactly the same position before each pause.
      animation = row.animate(
        [
          { transform: 'translateX(0)', offset: 0 },
          { transform: 'translateX(0)', offset: 3 / duration },
          { transform: `translateX(-${distance}px)`, offset: 1 },
        ],
        { duration: duration * 1000, iterations: Infinity, easing: 'linear' },
      );
    };
    fit();
    media.addEventListener('change', fit);
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    observer.observe(label);
    return () => {
      media.removeEventListener('change', fit);
      observer.disconnect();
      animation?.cancel();
    };
  }, [text]);
  return (
    <span ref={viewport} className="marquee" title={text} data-overflow={overflow || undefined}>
      <span ref={track} className="marquee-track">
        <span ref={original}>{text}</span>
        <span aria-hidden="true" className="marquee-copy">
          {text}
        </span>
      </span>
    </span>
  );
}
