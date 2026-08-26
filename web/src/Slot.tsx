import { useState } from "react";
import { icons } from "./icons.ts";
import type { Pillar, RealityCheck } from "./types.ts";

const ORDER: Pillar["key"][] = ["commute", "safety", "cost", "amenities"];

function PillarRow({ pillar }: { pillar: Pillar }) {
  if (pillar.unavailable) {
    return (
      <div className="pillar-row out">
        <span className="name">{pillar.key}</span>
        <div className="track" />
        <span className="val">—</span>
        <p className="headline">{pillar.unavailable}</p>
      </div>
    );
  }
  return (
    <div className={`pillar-row ${pillar.band}`}>
      <span className="name">{pillar.key}</span>
      <div className="track" role="img" aria-label={`${pillar.score} out of 100`}>
        <i style={{ width: `${pillar.score}%` }} />
      </div>
      <span className="val">{pillar.score}</span>
      <p className="headline">{pillar.headline}</p>
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
}: {
  ordinal: string;
  check: RealityCheck | null;
  onClear: () => void;
  onDropAddress: (address: string) => void;
}) {
  const [over, setOver] = useState(false);

  const dropProps = {
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
      if (addr) onDropAddress(addr);
    },
  };

  if (!check) {
    return (
      <div className={over ? "slot over" : "slot"} {...dropProps}>
        <img src={icons.home} alt="" />
        <span>Add {ordinal} listing</span>
      </div>
    );
  }

  return (
    <div className={over ? "slot filled over" : "slot filled"} {...dropProps}>
      <div className="slot-head">
        <div>
          <div className="slot-addr">{check.listing.address}</div>
          <p className="slot-summary">{check.summary}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className={`slot-total ${check.band ?? ""}`}>{check.score ?? "—"}</div>
          <button className="drop" onClick={onClear}>clear</button>
        </div>
      </div>
      <div className="pillars">
        {ORDER.map((key) => {
          const p = check.pillars.find((x) => x.key === key);
          return p ? <PillarRow key={key} pillar={p} /> : null;
        })}
      </div>
    </div>
  );
}
