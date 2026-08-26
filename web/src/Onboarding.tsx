import { useState } from "react";
import { AddressInput } from "./AddressInput.tsx";
import { icons } from "./icons.ts";
import type { Priority } from "./types.ts";

const CHOICES: Priority[] = ["commute", "safety", "cost"];

/**
 * Figma node 2135:6277 — "onboarding, must fill out to continue".
 *
 * The frame name is the spec: on a first run there is no way out, because
 * without a workplace the commute pillar has nothing to route to and reports
 * itself unavailable. Reopened later from the header pencil there is already a
 * workplace to fall back on, so that case gets the close control.
 */
export function Onboarding({
  initialWork,
  initialPriorities,
  onDone,
  onCancel,
}: {
  initialWork: string;
  initialPriorities: Priority[];
  onDone: (work: string, priorities: Priority[]) => void;
  onCancel?: () => void;
}) {
  const [work, setWork] = useState(initialWork);
  const [priorities, setPriorities] = useState<Priority[]>(initialPriorities);

  // Ranked, not merely picked — first choice weighs 2.5x, second 1.75x, third
  // 1.25x — so the order has to be visible and undoable.
  const toggle = (p: Priority) =>
    setPriorities((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Before you start">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          if (work.trim()) onDone(work.trim(), priorities);
        }}
      >
        {onCancel && (
          <button type="button" className="close" onClick={onCancel} aria-label="Close">
            <img src={icons.cross} alt="" />
          </button>
        )}

        <img className="mark" src={icons.mark} alt="" />

        <div className="modal-body">
          <h3>Before you start, tell us what matters.</h3>

          <label htmlFor="work">Where do you commute to?</label>
          <AddressInput
            value={work}
            onChange={setWork}
            placeholder="Search address"
            icon={icons.search}
            wrapperClass="field"
            inputId="work"
            maxHeight={150}
            autoFocus
          />

          <div className="gap" />

          <label>What matters most to you?</label>
          <div className="choices">
            {CHOICES.map((p) => {
              const rank = priorities.indexOf(p);
              return (
                <button
                  type="button"
                  key={p}
                  className={rank > -1 ? "choice on" : "choice"}
                  onClick={() => toggle(p)}
                  aria-pressed={rank > -1}
                >
                  {rank > -1 && <b>{rank + 1}</b>}
                  {p[0]!.toUpperCase() + p.slice(1)}
                </button>
              );
            })}
          </div>

          <button className="action" disabled={!work.trim()}>Continue</button>
        </div>
      </form>
    </div>
  );
}
