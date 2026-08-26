import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Scroll state for a horizontal card rail.
 *
 * The arrows used to stay lit at both ends, so the first click in either
 * direction could do nothing and leave you wondering whether the control was
 * broken. This reports whether there is anywhere left to go.
 */
export function useRail(
  /**
   * How many cards the rail holds. Required: the cards arrive asynchronously,
   * and a ResizeObserver on the rail will not report it -- the container keeps
   * the same box while its *contents* grow, so the measurement taken while it
   * was empty would stand forever and both arrows would stay disabled.
   */
  count: number,
  step = 290,
) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A pixel of slack: fractional scroll positions and zoom mean the end is
    // rarely reached exactly.
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Cards arriving, or the column resizing, both change what is reachable.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
    // `count` matters here, not just for measuring: the rail does not exist on
    // the first render, so with a stable dependency list this effect ran once
    // against a null ref, attached nothing, and never ran again.
  }, [measure, count]);

  const scroll = useCallback((dir: -1 | 1) => ref.current?.scrollBy({ left: dir * step }), [step]);

  return { ref, atStart, atEnd, scroll, measure };
}
