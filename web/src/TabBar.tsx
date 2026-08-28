import { icons } from "./icons.ts";

/**
 * The phone's navigation: Figma node 2113:8.
 *
 * On the desktop board the two destinations are links in the top bar. The
 * mobile design takes them out of it entirely and floats them in a 135x60 pill
 * at the bottom-left, one 30px circle per tab with a 10px label beneath.
 *
 * Two things in the design are wireframe rather than intent, and are read as
 * such here: the pill's mid-grey, which becomes the app's own card surface,
 * and the two crossed-out circles standing in for icons, which become the
 * search and heart glyphs the rest of the app already uses for these two
 * ideas. The accent behind the active circle is what the top bar's underline
 * says on the desktop.
 */
export function TabBar({
  tab,
  savedCount,
  /** Lifted off the bottom edge to clear the collapsed Add-a-listing sheet. */
  raised,
  onCheck,
  onSaved,
}: {
  tab: "check" | "saved";
  savedCount: number;
  raised: boolean;
  onCheck: () => void;
  onSaved: () => void;
}) {
  return (
    <nav className={raised ? "tabbar raised" : "tabbar"} aria-label="Main">
      <button
        className={tab === "check" ? "tab on" : "tab"}
        aria-current={tab === "check" ? "page" : undefined}
        onClick={onCheck}
      >
        <span className="tab-mark">
          <img src={icons.search} alt="" />
        </span>
        Check
      </button>

      <button
        className={tab === "saved" ? "tab on" : "tab"}
        aria-current={tab === "saved" ? "page" : undefined}
        /* Signed out there is no list to show, so this is an invitation to
           sign in -- the same bargain the desktop tab strikes. */
        onClick={onSaved}
      >
        <span className="tab-mark">
          <img src={icons.heartOutline} alt="" />
          {/* The desktop tab spells the count into its label. There is no room
              for "Saved (3)" at 10px, so the number rides on the circle. */}
          {savedCount > 0 && <i className="tab-count">{savedCount}</i>}
        </span>
        Saved
      </button>
    </nav>
  );
}
