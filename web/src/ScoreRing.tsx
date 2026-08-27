import type { Band } from "./types.ts";

/**
 * A score as a ring, with the figure in the middle.
 *
 * Shared by the Saved list and the comparison slots, which draw the same
 * control at the same size (Figma nodes 2130:4433 and 2176:7546).
 *
 * Drawn rather than exported: the arc length is data, so it cannot be an icon
 * file. The design paints it dark; this uses the band colour, because every
 * other score in the app is already good / moderate / poor coloured and a
 * neutral one would be the only score that says nothing about how it feels.
 */

/** 2πr, so the dash lengths below are a share of exactly one circle. */
const R = 26;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function ScoreRing({
  score,
  band,
  label = "Score",
}: {
  score: number | null;
  band: Band | null;
  /** The caption under the ring. Pass null for none. */
  label?: string | null;
}) {
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score));
  const arc = (pct / 100) * CIRCUMFERENCE;

  return (
    <span className="score-ring-wrap">
      <span className="score-ring">
        <svg viewBox="0 0 58 58" width="58" height="58" aria-hidden="true">
          <circle className="ring-track" cx="29" cy="29" r={R} />
          {score !== null && (
            <circle
              className={`ring-arc ${band ?? ""}`}
              cx="29"
              cy="29"
              r={R}
              // From twelve o'clock, clockwise, which is how a ring is read.
              transform="rotate(-90 29 29)"
              strokeDasharray={`${arc} ${CIRCUMFERENCE - arc}`}
            />
          )}
        </svg>
        <span className="ring-pct">{score === null ? "—" : `${score}%`}</span>
      </span>
      {label && <span className="score-ring-label">{label}</span>}
    </span>
  );
}
