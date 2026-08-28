import { useEffect, useRef, useState } from "react";
import { icons } from "./icons.ts";
import { ScoreRing } from "./ScoreRing.tsx";
import { withoutState } from "./address.ts";
import { useMobile } from "./useMobile.ts";
import { DROP_EVENT, type DragPayload } from "./touchDrag.ts";
import type { Pillar, RealityCheck } from "./types.ts";

/**
 * The three the designs show, and the three the card is for: they are what the
 * composite is ranked on and what someone picks a place by. Amenities is still
 * scored and still weighs on the total -- it just reads on the listing's own
 * reality check and in the side-by-side breakdown, rather than as a fourth bar
 * on a card meant to be taken in at a glance.
 */
const ORDER: Pillar["key"][] = ["commute", "safety", "cost"];

/**
 * One line per pillar: what it is, how it scores, the number.
 *
 * A headline used to sit under every bar. Four of them doubled the card's
 * height and stacked four lines of ragged small text, which turned a card meant
 * to be compared at a glance into one that had to be read. They are still on
 * the reality check, a click away, and still here on hover -- but the bars are
 * what this card is for, and two of them side by side only work if the eye can
 * cross between them.
 */
function PillarRow({ pillar }: { pillar: Pillar }) {
  if (pillar.unavailable) {
    return (
      <div className="pillar-row out" title={pillar.unavailable}>
        <span className="name">{pillar.key}</span>
        <div className="track" />
        <span className="val">—</span>
      </div>
    );
  }
  return (
    <div className={`pillar-row ${pillar.band}`} title={pillar.headline}>
      <span className="name">{pillar.key}</span>
      <div className="track" role="img" aria-label={`${pillar.score} out of 100`}>
        <i style={{ width: `${pillar.score}%` }} />
      </div>
      <span className="val">{pillar.score}</span>
    </div>
  );
}

/**
 * "Drag a card into a slot above" is the design's own instruction, so the slots
 * are real drop targets: dropping a neighbourhood card here scores it straight
 * into this slot rather than round-tripping through the sidebar form.
 */
export function Slot({
  ordinal,
  check,
  onClear,
  onDropAddress,
  onAdd,
}: {
  ordinal: string;
  check: RealityCheck | null;
  onClear: () => void;
  /** `rent` is present when the dragged card knew one, e.g. a rental listing. */
  onDropAddress: (address: string, rent?: string) => void;
  /**
   * Open the form to fill this slot. Passed only on the phone, where the form
   * is a sheet that has to be summoned -- the desktop's is a panel already
   * sitting beside these slots, so there is nothing there to open.
   *
   * Without it an empty slot is only a drop target, which is to say it does
   * nothing at all until a card exists to drop, while reading as an
   * instruction: "Add 1st listing". This makes the label true.
   */
  onAdd?: () => void;
}) {
  const [over, setOver] = useState(false);
  /**
   * The phone's empty slot is a button that opens the form, so its mark says
   * the action -- a plus. The desktop's is not pressable at all; it is a place
   * a card is dropped, and a house is what it is a place for.
   */
  const mobile = useMobile();

  /**
   * The same drop, arriving the other way.
   *
   * HTML5 drag and drop hands the payload to `onDrop` below; a finger cannot
   * use that API at all, so touchDrag.ts dispatches this instead on whatever
   * slot it was let go over. Both roads end at the same `onDropAddress`.
   */
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const dropped = (e: Event) => {
      const { address, rent } = (e as CustomEvent<DragPayload>).detail;
      onDropAddress(address, rent);
    };
    node.addEventListener(DROP_EVENT, dropped);
    return () => node.removeEventListener(DROP_EVENT, dropped);
  }, [onDropAddress]);

  const dropProps = {
    ref: box,
    /* What touchDrag.ts hit-tests for. */
    "data-drop-slot": "",
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const addr = e.dataTransfer.getData("text/plain");
      // Set by cards that know a price; absent for neighbourhood blocks, and
      // absent in any browser that refuses the custom type.
      const rent = e.dataTransfer.getData("application/x-reality-check-rent");
      if (addr) onDropAddress(addr, rent || undefined);
    },
  };

  if (!check) {
    const tappable = onAdd
      ? {
          role: "button" as const,
          tabIndex: 0,
          onClick: onAdd,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onAdd();
            }
          },
        }
      : null;
    return (
      <div className={over ? "slot over" : "slot"} {...dropProps} {...tappable}>
        <img src={mobile ? icons.plus : icons.home} alt="" />
        <span>Add {ordinal} listing</span>
      </div>
    );
  }

  return (
    <div className={over ? "slot filled over" : "slot filled"} {...dropProps}>
      <div className="slot-head">
        <div className="slot-id">
          {/* Without the state and zip, as the design sets it -- they are the same
              for every listing here, and the full string wrapped to two lines
              once the clear control took its corner. */}
          <div className="slot-addr">{withoutState(check.listing.address)}</div>
          {/* At 137px wide the verdict ran to four lines and pushed the score
              off the card. It is the first thing on the listing's own page,
              which this card is a tap away from. */}
          {!mobile && <p className="slot-summary">{check.summary}</p>}
          <p className="slot-rent">
            {check.listing.rent ? (
              <>
                <b>${check.listing.rent.toLocaleString()}</b> / mo
              </>
            ) : (
              "No rent given"
            )}
          </p>
        </div>
        {/* The phone wears the same pill the reality check does (node
            2136:6532) rather than the ring: it carries the band colour across
            the full width of a narrow card, where a 44px ring was a small
            thing in a lot of empty space. */}
        {mobile ? (
          check.score !== null && (
            <span className={`rc-score ${check.band ?? ""}`}>{check.score}% score</span>
          )
        ) : (
          <ScoreRing score={check.score} band={check.band} />
        )}
      </div>

      <div className="pillars">
        {ORDER.map((key) => {
          const p = check.pillars.find((x) => x.key === key);
          return p ? <PillarRow key={key} pillar={p} /> : null;
        })}
      </div>

      {/* The design carries no clear control, and a slot that cannot be emptied
          is a dead end -- so it is here, in the corner the score ring does not
          occupy, and only once the card is under the cursor. Same bargain the
          Saved page strikes with its heart. */}
      <button
        className="slot-clear"
        onClick={onClear}
        aria-label="Remove this listing from the comparison"
        title="Remove this listing"
      >
        <img src={icons.cross} alt="" />
      </button>
    </div>
  );
}
