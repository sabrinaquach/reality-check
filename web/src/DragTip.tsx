import { useState } from "react";
import { icons } from "./icons.ts";
import { useMobile } from "./useMobile.ts";

/**
 * How to get a card from a rail into a comparison slot.
 *
 * This used to be the subtitle under "Safest neighborhoods nearby" -- which
 * put an instruction where a description belongs, said it on one section when
 * it is true of all three, and went on saying it forever to someone who
 * learned it the first day. It is a notice, so it behaves like one: shown
 * until it is dismissed, then gone for good.
 *
 * The wording is not the same on both. On a mouse the gesture is a plain drag;
 * on a touch screen it is a press and hold first, because a card also sits in
 * a rail that scrolls sideways on a page that scrolls down, and holding still
 * is what tells those three apart. That is the one thing about this gesture
 * nobody can guess, so it is the thing worth a notice.
 */

const KEY = "reality-check.drag-tip";

function alreadySeen() {
  try {
    return localStorage.getItem(KEY) === "seen";
  } catch {
    return false; // private window: show it, which is the harmless way to be wrong
  }
}

export function DragTip() {
  const mobile = useMobile();
  const [seen, setSeen] = useState(alreadySeen);
  if (seen) return null;

  return (
    <div className="tip" role="note">
      <img className="tip-mark" src={icons.drag} alt="" />
      <p>
        {mobile
          ? "Press and hold a card below, then drag it into a slot above to compare it."
          : "Drag a card from any row below into a slot above to compare it."}
      </p>
      <button
        className="tip-close"
        aria-label="Dismiss this tip"
        onClick={() => {
          setSeen(true);
          try {
            localStorage.setItem(KEY, "seen");
          } catch {
            // Not being able to remember is survivable; it reappears next time.
          }
        }}
      >
        <img src={icons.cross} alt="" />
      </button>
    </div>
  );
}
