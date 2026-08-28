import { useLayoutEffect, useRef } from "react";

/**
 * The bottom sheet the phone design puts "Add a listing" in: Figma node
 * 2113:546. A panel pinned to the foot of the screen with a 122x6 grab handle
 * centred 11px below its top edge, holding the same form the desktop shows in
 * its sidebar.
 *
 * It is dragged, not tapped. The handle is the affordance for a swipe and
 * nothing else, so the panel follows the finger the whole way and settles
 * where it is let go -- a tap on it does nothing.
 *
 * Closed, only the handle's own strip is left on screen. The panel behind it
 * is summoned by tapping an empty comparison slot -- the Figma frame is named
 * "Click add 1st property from home", so that is the way in the design shows.
 * The strip stays because the slots are not the only reason to open this: a
 * listing can be checked without being compared, and with both slots full
 * there would otherwise be no door left at all.
 *
 * Nothing here is React state, deliberately. The first version moved the sheet
 * by setting state on every pointermove, which re-rendered this component and
 * everything under it -- the whole form -- a hundred times a second while the
 * finger was down, and the panel visibly lagged behind the touch. The drag now
 * writes `transform` straight to the node, so a gesture costs no renders at
 * all; React is left to own the resting position and nothing else. It is also
 * why this element has no `style` prop: transform and transition belong to
 * this file, and React must not diff them out from under it.
 */

/** Past this share of the travel, letting go commits instead of springing back. */
const COMMIT = 0.25;

/** ...or this fast, in px/ms, however far the drag actually got. */
const FLICK = 0.4;

/**
 * Velocity is measured over the tail of the gesture rather than all of it, so
 * a slow drag that ends in a flick is read as the flick it was.
 */
const TAIL_MS = 50;

type Gesture = {
  id: number;
  /** Where the finger went down, and where the sheet was resting then. */
  y: number;
  offset: number;
  /** The most recent sample at least TAIL_MS old, for the release velocity. */
  tailY: number;
  tailAt: number;
};

export function MobileSheet({
  open,
  onOpenChange,
  /** Names the handle for a screen reader, which the bare strip cannot. */
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const grab = useRef<HTMLButtonElement>(null);

  /** How far below its open position the closed sheet sits. */
  const travel = useRef(0);
  const gesture = useRef<Gesture | null>(null);
  /** Read inside the observer, which outlives any one render's `open`. */
  const isOpen = useRef(open);
  isOpen.current = open;
  /** Suppresses the animation on the very first placement. */
  const placed = useRef(false);

  function place(offset: number, animate: boolean) {
    const s = sheet.current;
    if (!s) return;
    // "" hands the transition back to the stylesheet rather than naming it twice.
    s.style.transition = animate ? "" : "none";
    s.style.transform = `translateY(${offset}px)`;
  }

  const rest = () => (isOpen.current ? 0 : travel.current);

  /**
   * Measured rather than assumed, and measured continuously: the panel grows
   * when an error appears under the form and shrinks when it clears, and a
   * travel computed once would leave the closed sheet showing the wrong slice
   * of itself from then on.
   *
   * The tab pill is a fixed sibling that has to sit clear of the closed lip,
   * so the lip's height is published where any fixed element can read it.
   */
  useLayoutEffect(() => {
    const measure = () => {
      const s = sheet.current;
      const g = grab.current;
      if (!s || !g) return;
      const lip = g.offsetHeight;
      // The sheet's full height: it is not a scroller and has no max-height,
      // because an overflow other than visible clipped the address field's
      // suggestions. So this is the real content height, and the panel is
      // short enough that it is also less than a screen.
      travel.current = Math.max(0, s.offsetHeight - lip);
      document.documentElement.style.setProperty("--sheet-lip", `${lip}px`);
      // A finger is the authority while one is down; this would fight it.
      if (gesture.current) return;
      place(rest(), placed.current);
      placed.current = true;
    };

    measure();
    const ro = new ResizeObserver(measure);
    if (sheet.current) ro.observe(sheet.current);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--sheet-lip");
    };
  }, []);

  /** Follows `open` when something other than a gesture changes it. */
  useLayoutEffect(() => {
    if (!gesture.current) place(open ? 0 : travel.current, placed.current);
  }, [open]);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    const offset = rest();
    gesture.current = {
      id: e.pointerId,
      y: e.clientY,
      offset,
      tailY: e.clientY,
      tailAt: e.timeStamp,
    };
    // Pinned to the finger: an easing curve here would trail behind the touch.
    place(offset, false);
    // So the drag survives the finger leaving the handle, which it will --
    // the handle is 30px tall and the travel is most of the screen.
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    place(Math.min(travel.current, Math.max(0, g.offset + (e.clientY - g.y))), false);
    if (e.timeStamp - g.tailAt > TAIL_MS) {
      g.tailY = e.clientY;
      g.tailAt = e.timeStamp;
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;

    const moved = e.clientY - g.y;
    const speed = (e.clientY - g.tailY) / Math.max(1, e.timeStamp - g.tailAt);

    // A flick is judged on its direction alone -- it is a statement of intent,
    // and asking it to also cross a quarter of the screen would ignore it.
    // Anything slower is judged on how far it actually got, and a gesture that
    // did neither springs back to where it started.
    const next =
      Math.abs(speed) > FLICK ? speed < 0
      : travel.current > 0 && Math.abs(moved) > travel.current * COMMIT ? moved < 0
      : open;

    // Always placed, never left to the re-render: when `next` matches `open`
    // there is no prop change to react to, and the panel would stay wherever
    // the finger abandoned it.
    isOpen.current = next;
    place(next ? 0 : travel.current, true);
    if (next !== open) onOpenChange(next);
  }

  return (
    <div className={open ? "sheet open" : "sheet"} ref={sheet}>
      <button
        className="sheet-grab"
        ref={grab}
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "Close" : "Open"} ${title}. Swipe up or down.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        /**
         * A keyboard has no swipe, and Enter and Space on a button arrive as a
         * click -- with `detail` 0, which is what tells them apart from a tap.
         * So the gesture stays the only way to work this by hand, and the
         * control is still operable without one.
         */
        onClick={(e) => e.detail === 0 && onOpenChange(!open)}
      >
        <span className="sheet-handle" />
      </button>

      {/* Always laid out: the closed state is this panel pushed off the bottom
          of the screen, so there has to be something there to push. Inert with
          it, or the address field inside would still take a tab stop while it
          is out of sight. */}
      <div className="sheet-body" inert={!open}>
        {children}
      </div>
    </div>
  );
}
