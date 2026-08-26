import { useEffect, useId, useRef, useState } from "react";

export type Suggestion = { main: string; secondary: string; full: string };

/** Long enough that the list is useful, short enough not to feel laggy. */
const DEBOUNCE_MS = 250;
const MIN_CHARS = 3;

const newSession = () =>
  (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)) as string;

/**
 * Address field with Google-style autocomplete.
 *
 * The suggestions are advisory, never mandatory: whatever is typed is what gets
 * scored, so an address the API has never heard of still works. That matters
 * because the Census geocoder behind the engine handles plain street addresses
 * that Places sometimes misses.
 */
export function AddressInput({
  value,
  onChange,
  placeholder,
  icon,
  wrapperClass,
  inputId,
  ariaLabel,
  autoFocus,
  placement = "down",
  maxHeight = 260,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon: string;
  wrapperClass: string;
  inputId?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  /**
   * Which way the list opens. A list that covers the panel's own buttons makes
   * them unclickable -- the click lands on a suggestion instead -- so callers
   * whose actions sit below the field open upwards.
   */
  placement?: "up" | "down";
  /** Cap for callers that open downwards but still have something to protect. */
  maxHeight?: number;
}) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const session = useRef(newSession());
  const abort = useRef<AbortController | null>(null);
  // Set when a value arrives from a click or Enter, so the effect below does
  // not immediately re-query for the text it just filled in.
  const justPicked = useRef(false);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  // Clicking anywhere else should dismiss the list, not just blurring the input.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < MIN_CHARS) {
      setItems([]);
      setOpen(false);
      return;
    }
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      try {
        const res = await fetch(
          `/api/suggest?q=${encodeURIComponent(q)}&session=${session.current}`,
          { signal: ctl.signal },
        );
        const body = await res.json();
        setItems(body.suggestions ?? []);
        setActive(-1);
        setOpen((body.suggestions ?? []).length > 0);
      } catch {
        // An aborted or failed lookup should never interrupt typing.
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  function pick(s: Suggestion) {
    justPicked.current = true;
    onChange(s.full);
    setOpen(false);
    setItems([]);
    // A Places "session" ends at selection; the next search starts a new one.
    session.current = newSession();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter" && active > -1) {
      e.preventDefault();
      pick(items[active]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="ac" ref={box}>
      <div className={wrapperClass}>
        <img src={icon} alt="" />
        <input
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => items.length && setOpen(true)}
          // Deferred so a click on an option lands before the list unmounts.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active > -1 ? `${listId}-${active}` : undefined}
        />
      </div>

      {open && items.length > 0 && (
        <ul
          className={placement === "up" ? "ac-list up" : "ac-list"}
          id={listId}
          role="listbox"
          style={{ maxHeight }}
        >
          {items.map((s, i) => (
            <li
              key={s.full + i}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "on" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
            >
              <span className="ac-main">{s.main}</span>
              {s.secondary && <span className="ac-sub">{s.secondary}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
