/**
 * Dragging a card into a comparison slot with a finger.
 *
 * The board has always done this with HTML5 drag and drop, which touch screens
 * do not implement: `dragstart` never fires from a finger, so on a phone the
 * slots were a drop target nothing could reach. This is the same gesture
 * rebuilt on pointer events. The mouse is left to its own machinery -- it
 * already works, and two implementations racing over one gesture is worse than
 * either.
 *
 * The whole card is the handle, which is the interesting part. A card sits in
 * a rail that scrolls sideways, on a page that scrolls down, so the same
 * finger-down means three different things and only the next moment says
 * which. `touch-action: none` would settle it by giving the card every
 * gesture, and cost the page its scrolling wherever a rail covers it -- most
 * of the board. So the card is picked up by holding it still instead: move
 * inside HOLD_MS and it was a scroll, stay put and it was a pick-up.
 *
 * Which is also why the listener that stops the scroll is registered on the
 * way down rather than when the hold completes. Once a browser has begun
 * scrolling it will not give it back, so the only moment it can be stopped is
 * the first touchmove -- by which time there is no chance to go and add a
 * listener for it.
 */

export type DragPayload = {
  address: string;
  /** Present when the card knows a price, as a rental listing does. */
  rent?: string;
  /** What the thing being dragged is called, for the label under the finger. */
  label: string;
};

/** Dispatched on the slot the finger let go over. */
export const DROP_EVENT = "reality-check:drop";

/** Marks an element as somewhere a card can be dropped. */
export const DROP_ATTR = "data-drop-slot";

/**
 * The hover state, as an attribute rather than a class.
 *
 * A class would be reconciled away: the slot's className is React's, and any
 * re-render during the drag -- the form above it clearing an error, say --
 * would rewrite it without the one this added. React does not manage this
 * attribute, so nothing takes it back but this file.
 */
const OVER_ATTR = "data-over";

/** How long a finger rests on a card before it counts as picking it up. */
const HOLD_MS = 300;

/** Movement before that, in px, which means this was a scroll after all. */
const SLOP = 8;

export function beginCardDrag(e: React.PointerEvent, payload: DragPayload): void {
  if (e.pointerType === "mouse") return;

  const card = e.currentTarget as HTMLElement;
  const from = { x: e.clientX, y: e.clientY };
  let held = false;
  let over: Element | null = null;
  let ghost: HTMLDivElement | null = null;

  function at(x: number, y: number) {
    // Lifted clear of the fingertip, which is otherwise covering the label.
    ghost!.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 160%))`;
    // The ghost is pointer-events: none, so this reads the slot beneath it.
    const slot = document.elementFromPoint(x, y)?.closest(`[${DROP_ATTR}]`) ?? null;
    if (slot === over) return;
    over?.removeAttribute(OVER_ATTR);
    slot?.setAttribute(OVER_ATTR, "");
    over = slot;
  }

  function finish(dropped: boolean) {
    window.clearTimeout(timer);
    window.removeEventListener("touchmove", block);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);

    ghost?.remove();
    card.classList.remove("dragging");
    over?.removeAttribute(OVER_ATTR);
    if (held && dropped) {
      over?.dispatchEvent(new CustomEvent<DragPayload>(DROP_EVENT, { detail: payload }));
      // The finger went down on a card whose whole job is to open on a tap.
      // Letting go after carrying it somewhere is not that tap.
      swallowNextClick(card);
    }
    over = null;
  }

  function block(ev: TouchEvent) {
    if (held) ev.preventDefault();
  }
  function move(ev: PointerEvent) {
    if (held) {
      at(ev.clientX, ev.clientY);
    } else if (Math.abs(ev.clientX - from.x) > SLOP || Math.abs(ev.clientY - from.y) > SLOP) {
      // A scroll, and the browser is already running it. Stand down.
      finish(false);
    }
  }
  function up() {
    finish(true);
  }
  function cancel() {
    finish(false);
  }

  const timer = window.setTimeout(() => {
    held = true;
    card.classList.add("dragging");
    ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = payload.label;
    document.body.append(ghost);
    at(from.x, from.y);
  }, HOLD_MS);

  window.addEventListener("touchmove", block, { passive: false });
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
}

/** Eats the click a finger leaves behind when it lets go, and only that one. */
function swallowNextClick(card: HTMLElement) {
  const eat = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  card.addEventListener("click", eat, { capture: true, once: true });
  // If no click follows -- the drop landed on a slot, so the card never got
  // one -- the listener would otherwise sit there and eat the next real tap.
  window.setTimeout(() => card.removeEventListener("click", eat, { capture: true }), 500);
}
