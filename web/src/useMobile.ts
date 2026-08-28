import { useEffect, useState } from "react";

/**
 * The width at which the phone screens take over. The Figma mobile frames are
 * drawn at 402px (node 2113:6); 700px is where the desktop board has already
 * lost its second column and its page padding has stepped down to the phone's,
 * so it is the honest place for the rest of the layout to follow.
 */
export const MOBILE_QUERY = "(max-width: 700px)";

/**
 * Whether the phone layout is showing.
 *
 * Matched on width rather than sniffed from the user agent: a narrow desktop
 * window is the same layout problem as a phone, and the CSS below this hook
 * switches on the same query -- so the chrome React renders and the chrome CSS
 * styles can never disagree about which layout is on screen.
 */
export function useMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => globalThis.matchMedia?.(MOBILE_QUERY).matches ?? false,
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    // Re-read on mount: the first render may have happened before the window
    // settled at its final size, or on a server with no matchMedia at all.
    setMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return mobile;
}
