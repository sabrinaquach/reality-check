import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddListing } from "./AddListing.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { PlacesNearWork } from "./PlacesNearWork.tsx";
import { QuietNearby, type QuietSpot } from "./QuietNearby.tsx";
import { AffordableNearby, type AffordableResult } from "./AffordableNearby.tsx";
import { RealityCheckPage } from "./RealityCheckPage.tsx";
import { ComparePage } from "./ComparePage.tsx";
import { SavedPage } from "./SavedPage.tsx";
import { ZoneMap, type MapListing } from "./ZoneMap.tsx";
import { SignIn } from "./SignIn.tsx";
import { isSaved, loadSaved, persistSaved, removeSaved, toggleSaved } from "./saved.ts";
import { Slot } from "./Slot.tsx";
import { icons } from "./icons.ts";
import type { Priority, RealityCheck } from "./types.ts";

const ONBOARDING_KEY = "reality-check.onboarding";

/** How far below the top of the window the comparison box parks. */
const STICK_TOP = 12;

type Onboarding = { work: string; priorities: Priority[] };

function loadOnboarding(): Onboarding | null {
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    return raw ? (JSON.parse(raw) as Onboarding) : null;
  } catch {
    return null; // private window, blocked storage -- just onboard again
  }
}

export function App() {
  const onboard = loadOnboarding();
  const [work, setWork] = useState(onboard?.work ?? "");
  const [priorities, setPriorities] = useState<Priority[]>(onboard?.priorities ?? []);
  const [onboarding, setOnboarding] = useState(!onboard?.work);
  const [signIn, setSignIn] = useState(false);

  const [slots, setSlots] = useState<[RealityCheck | null, RealityCheck | null]>([null, null]);
  // "Check listing" opens the single-listing result; "Add to comparison" fills a slot.
  const [detail, setDetail] = useState<RealityCheck | null>(null);
  /** The side-by-side breakdown, opened as soon as both slots are full. */
  const [comparing, setComparing] = useState(false);
  /**
   * The two listings Saved is comparing, kept apart from the board's slots.
   *
   * They were the same state, which meant picking a pair on Saved quietly
   * filled the comparison box on Check a listing too -- a second screen
   * changing under you because of something you did on this one. The board's
   * slots belong to the board.
   */
  const [pair, setPair] = useState<[RealityCheck | null, RealityCheck | null]>([null, null]);
  const pairFull = pair[0] !== null && pair[1] !== null;
  const [saved, setSaved] = useState<RealityCheck[]>(loadSaved);
  const [tab, setTab] = useState<"check" | "saved">("check");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [areas, setAreas] = useState<AffordableResult | null>(null);
  const [areasLoading, setAreasLoading] = useState(false);
  const [areasError, setAreasError] = useState<string | null>(null);

  /**
   * Whether the comparison box has stuck to the top of the window.
   *
   * A sentinel above the board is watched rather than the box itself: once the
   * box is stuck its own position stops changing, so it can no longer tell you
   * anything. Held as state because the condensed look is a class, and set
   * through a callback ref so it survives the board mounting and unmounting as
   * tabs change.
   */
  const [stuck, setStuck] = useState(false);
  const stickWatcher = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    stickWatcher.current?.disconnect();
    if (!node) {
      setStuck(false);
      return;
    }
    stickWatcher.current = new IntersectionObserver(
      ([entry]) => setStuck(!entry?.isIntersecting),
      { rootMargin: `-${STICK_TOP + 1}px 0px 0px 0px` },
    );
    stickWatcher.current.observe(node);
  }, []);

  const [spots, setSpots] = useState<QuietSpot[] | null>(null);
  const [workAt, setWorkAt] = useState<{ lat: number; lng: number } | null>(null);
  const [spotsLoading, setSpotsLoading] = useState(false);
  const [spotsError, setSpotsError] = useState<string | null>(null);

  function finishOnboarding(nextWork: string, nextPriorities: Priority[]) {
    setWork(nextWork);
    setPriorities(nextPriorities);
    setOnboarding(false);
    try {
      localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ work: nextWork, priorities: nextPriorities }));
    } catch {
      // Not being able to remember the answers is survivable; scoring still works.
    }
  }

  const loadNearby = useCallback(async (near: string) => {
    if (!near) return;
    setSpotsLoading(true);
    setSpotsError(null);
    try {
      const res = await fetch(`/api/nearby?near=${encodeURIComponent(near)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load nearby blocks.");
      setSpots(body.spots as QuietSpot[]);
      setWorkAt(body.at ?? null);
    } catch (e) {
      setSpotsError((e as Error).message);
      setSpots(null);
    } finally {
      setSpotsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNearby(work);
  }, [work, loadNearby]);

  /**
   * Cheaper areas, from the workplace coordinates the block lookup already
   * resolved -- so this waits for those rather than geocoding again.
   */
  useEffect(() => {
    if (!workAt) return;
    let cancelled = false;
    setAreasLoading(true);
    setAreasError(null);
    fetch(`/api/affordable?lat=${workAt.lat}&lng=${workAt.lng}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) throw new Error(body.error);
        setAreas(body as AffordableResult);
      })
      .catch((e) => {
        if (!cancelled) {
          setAreasError((e as Error).message);
          setAreas(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAreasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workAt]);

  async function score(addr: string, rent: string, target: 0 | 1 | "append" | "detail") {
    setBusy(true);
    setError(null);
    const params = new URLSearchParams({ address: addr.trim() });
    if (work) params.set("to", work);
    if (rent.trim()) params.set("rent", rent.trim());
    if (priorities.length) params.set("priorities", priorities.join(","));
    try {
      const res = await fetch(`/api/score?${params}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      const check = body as RealityCheck;
      if (target === "detail") {
        setDetail(check);
        window.scrollTo(0, 0);
      } else {
        fillSlot(check, target);
      }
      setAddress("");
    } catch {
      setError("Could not reach the scoring service. Is `npm run dev` still running?");
    } finally {
      setBusy(false);
    }
  }

  const slotsFull = slots[0] !== null && slots[1] !== null;

  /**
   * Put a check into a slot. Filling the second one does not open the
   * breakdown -- that is what the button is for.
   *
   * It used to navigate automatically, on the reasoning that comparing is the
   * point of the board so the second slot is the answer arriving. Two things
   * since made that wrong. The comparison box is sticky so a card can be
   * dragged up from a rail 900px down the page, and auto-navigating meant that
   * drag succeeded and then threw you off the page you were working on. And
   * Saved fills its column in place when you pick two, so the same action
   * behaving differently here is a rule to learn twice.
   *
   * The board is already a comparison -- two cards, side by side, with a "vs"
   * between them. The breakdown is the detailed version, and asking for it is
   * one click on a button that is already lit.
   */
  function fillSlot(check: RealityCheck, target: 0 | 1 | "append") {
    const [a, b] = slots;
    const next: [RealityCheck | null, RealityCheck | null] =
      target === 0 ? [check, b] : target === 1 ? [a, check] : a === null ? [check, b] : [a, check];
    setSlots(next);
  }

  /** Emptying a slot leaves nothing to compare, so the breakdown closes with it. */
  function clearSlot(side: 0 | 1) {
    setSlots(([a, b]) => (side === 0 ? [null, b] : [a, null]));
    setComparing(false);
  }

  /**
   * Open a listing tapped on the map. It is one of the user's own, so its
   * reality check already exists -- reuse it rather than re-scoring, which
   * would cost another eight Google calls for an answer we already have.
   */
  /**
   * Fill in a rent after the fact. Only the cost pillar is recomputed, so this
   * costs nothing from the Google budget. The updated check replaces the copy
   * in the slots and in Saved too, so the rent does not silently disagree
   * between screens.
   */
  async function applyRent(check: RealityCheck, rent: number) {
    const res = await fetch("/api/cost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ check, rent }),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as RealityCheck;
    const key = updated.listing.address.trim().toLowerCase();
    const same = (c: RealityCheck | null) =>
      !!c && c.listing.address.trim().toLowerCase() === key;

    // Every copy of this listing, wherever it is being shown.
    setDetail((d) => (same(d) ? updated : d));
    setSlots(([a, b]) => [same(a) ? updated : a, same(b) ? updated : b]);
    setPair(([a, b]) => [same(a) ? updated : a, same(b) ? updated : b]);
    setSaved((list) => {
      const next = list.map((c) => (same(c) ? updated : c));
      if (next.some((c) => same(c))) persistSaved(next);
      return next;
    });
  }

  /** The opened listing's own cost card, which has a check to hand. */
  async function addRent(rent: number) {
    if (!detail) return;
    await applyRent(detail, rent);
  }

  /**
   * Bring a stored check's safety pillar up to date.
   *
   * Saved listings are kept whole in localStorage and reopened rather than
   * rescored, so one checked before the index learned about incident types
   * keeps a safety pillar with no breakdown in it -- and goes on reporting
   * that the index needs rebuilding no matter how many times it is rebuilt.
   * Recomputing this one pillar reads the local block index only, so it is
   * free; a full rescore would spend eight Google calls to fix it.
   */
  const refreshSafety = useCallback(async (check: RealityCheck) => {
    const safety = check.pillars.find((p) => p.key === "safety");
    if (!safety || safety.unavailable || safety.incidents) return;
    try {
      const res = await fetch("/api/safety", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ check }),
      });
      if (!res.ok) return;
      const updated = (await res.json()) as RealityCheck;
      const key = updated.listing.address.trim().toLowerCase();
      const same = (c: RealityCheck | null) =>
        !!c && c.listing.address.trim().toLowerCase() === key;

      setDetail((d) => (same(d) ? updated : d));
      setSlots(([a, b]) => [same(a) ? updated : a, same(b) ? updated : b]);
      setSaved((list) => {
        if (!list.some((c) => same(c))) return list;
        const next = list.map((c) => (same(c) ? updated : c));
        persistSaved(next);
        return next;
      });
    } catch {
      // The card still works; it just keeps the older pillar for now.
    }
  }, []);

  function openListing(address: string) {
    const key = address.trim().toLowerCase();
    const known = [...slots, ...saved].find(
      (c): c is RealityCheck => !!c && c.listing.address.trim().toLowerCase() === key,
    );
    if (known) {
      setDetail(known);
      window.scrollTo(0, 0);
      void refreshSafety(known);
      return;
    }
    void score(address, "", "detail");
  }

  /**
   * The only listings the app knows about: the two comparison slots and
   * anything saved. There is no rental feed, so this is what "listings on the
   * map" can honestly mean today.
   */
  const mapListings: MapListing[] = useMemo(() => {
    const seen = new Set<string>();
    const out: MapListing[] = [];
    const add = (c: RealityCheck, kind: MapListing["kind"]) => {
      const key = c.listing.address.trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        address: c.listing.address,
        lat: c.listing.lat,
        lng: c.listing.lng,
        rent: c.listing.rent ?? null,
        score: c.score,
        band: c.band,
        kind,
      });
    };
    for (const c of slots) if (c) add(c, "compared");
    for (const c of saved) add(c, "saved");
    return out;
  }, [slots, saved]);

  return (
    <>
      <nav className="nav">
        <img className="logo" src={icons.logo} alt="Reality Check" />
        <button
          className={tab === "check" ? "navlink on" : "navlink"}
          onClick={() => { setTab("check"); setDetail(null); setComparing(false); }}
        >
          Check a listing
        </button>
        <button
          className={tab === "saved" ? "navlink on" : "navlink"}
          onClick={() => { setTab("saved"); setDetail(null); setComparing(false); }}
        >
          Saved{saved.length ? ` (${saved.length})` : ""}
        </button>
        <span className="spacer" />
        <button className="signin" onClick={() => setSignIn(true)}>Sign in</button>
      </nav>

      <div className="page">
        {tab === "saved" ? (
          <SavedPage
            saved={saved}
            pairFull={pairFull}
            /**
             * Stay on Saved and open the listing in the right-hand column, so
             * the ranking is still there to move around in. Opening one listing
             * is a different question from comparing two, so it takes the
             * column back from the breakdown.
             */
            /**
             * Opening a listing shows its reality check but leaves the pair
             * alone. Clearing it here meant a stray click on a card wiped both
             * selections, which read as "unselecting one dropped the other".
             */
            onOpen={(c) => {
              setDetail(c);
              void refreshSafety(c);
            }}
            openKey={
              pairFull ? null : detail ? detail.listing.address.trim().toLowerCase() : null
            }
            /**
             * The right-hand column answers whichever question was asked last:
             * two listings picked shows the breakdown, one opened shows its
             * reality check, and neither leaves the map.
             */
            /**
             * Two picked shows the breakdown; anything less shows whichever
             * listing was opened, or the map. Unpicking one therefore leaves
             * the other selected and simply steps back to the single view.
             */
            detail={
              pair[0] && pair[1] ? (
                <ComparePage
                  inline
                  a={pair[0]}
                  b={pair[1]}
                  onOpen={(c) => {
                    setDetail(c);
                    void refreshSafety(c);
                  }}
                  onRent={applyRent}
                  listings={mapListings}
                  onCheck={(addr) => score(addr, "", "detail")}
                  onAdd={openListing}
                />
              ) : detail ? (
                <RealityCheckPage
                  inline
                  check={detail}
                  saved={isSaved(saved, detail)}
                  onToggleSave={() => setSaved((list) => toggleSaved(list, detail))}
                  onRent={addRent}
                  listings={mapListings}
                  onCheck={(addr) => score(addr, "", "detail")}
                  onAdd={openListing}
                />
              ) : undefined
            }
            /**
             * Picking works both ways, and never touches the board: this pair
             * lives and dies on the Saved page.
             */
            onToggleCompare={(c) => {
              const key = c.listing.address.trim().toLowerCase();
              const same = (x: RealityCheck | null) =>
                !!x && x.listing.address.trim().toLowerCase() === key;
              setPair(([a, b]) => {
                if (same(a)) return [b, null];
                if (same(b)) return [a, null];
                if (!a) return [c, b];
                if (!b) return [a, c];
                /**
                 * Both taken, and the design still gives the faded cards a
                 * pick circle -- so they have to do something. The pair rolls:
                 * the older listing drops out and the new one is compared
                 * against whichever was picked most recently.
                 */
                return [b, c];
              });
            }}
            inComparison={(c) => {
              const key = c.listing.address.trim().toLowerCase();
              return pair.some((p) => !!p && p.listing.address.trim().toLowerCase() === key);
            }}
            onRemove={(c) => setSaved((list) => removeSaved(list, c))}
            onBrowse={() => setTab("check")}
            at={workAt}
            listings={mapListings}
            onCheck={(addr) => score(addr, "", "detail")}
            onAdd={openListing}
          />
        ) : comparing && slots[0] && slots[1] ? (
          <ComparePage
            a={slots[0]}
            b={slots[1]}
            onRent={applyRent}
            onBack={() => setComparing(false)}
            onOpen={(c) => {
              setComparing(false);
              setDetail(c);
              window.scrollTo(0, 0);
              void refreshSafety(c);
            }}
            listings={mapListings}
            onCheck={(addr) => score(addr, "", "detail")}
            onAdd={openListing}
          />
        ) : detail ? (
          <RealityCheckPage
            check={detail}
            onBack={() => setDetail(null)}
            saved={isSaved(saved, detail)}
            onToggleSave={() => setSaved((list) => toggleSaved(list, detail))}
            onRent={addRent}
            listings={mapListings}
            onCheck={(addr) => score(addr, "", "detail")}
            onAdd={openListing}
            slotsFull={slotsFull}
          />
        ) : (
          <>
            <h1>Let's check a listing</h1>
        <p className="commuting">
          {work ? `Commuting to ${work}` : "No workplace set"}
          <button onClick={() => setOnboarding(true)} aria-label="Change your workplace and priorities">
            <img src={icons.edit} alt="" />
          </button>
        </p>

        {/* Watched, not drawn: the moment this scrolls out of view is the
            moment the box below it parks at the top. */}
        <div ref={sentinelRef} className="stick-sentinel" aria-hidden="true" />

        <div className="layout">
          <div className={stuck ? "slots stuck" : "slots"}>
              <Slot
                ordinal="1st"
                check={slots[0]}
                onClear={() => clearSlot(0)}
                onDropAddress={(a, rent) => score(a, rent ?? "", 0)}
              />
              <span className="vs">vs</span>
              <Slot
                ordinal="2nd"
                check={slots[1]}
                onClear={() => clearSlot(1)}
                onDropAddress={(a, rent) => score(a, rent ?? "", 1)}
              />

              {/* Figma node 2114:851 makes this a fixed part of the compare
                  box rather than something that appears, so it sits here from
                  the start and waits for the second listing. It doubles as the
                  way back into the breakdown after backing out of it: both
                  slots full is the only state that reaches it, and by then
                  there is no second slot left to fill. */}
              <button
                className="recompare"
                disabled={!slotsFull}
                title={
                  slotsFull
                    ? "Open the detailed breakdown"
                    : "Add two listings to compare them"
                }
                onClick={() => {
                  setComparing(true);
                  window.scrollTo(0, 0);
                }}
              >
                Compare listings
              </button>
          </div>

          <AddListing
            busy={busy}
            error={error}
            slotsFull={slotsFull}
            address={address}
            onAddressChange={setAddress}
            onSubmit={(a, r, mode) => score(a, r, mode === "replace" ? "detail" : "append")}
          />

          <div className="col">
            <PlacesNearWork
              work={work}
              at={workAt}
              onCheck={(addr, rent) => score(addr, rent, "detail")}
            />

            <QuietNearby
              work={work}
              spots={spots}
              loading={spotsLoading}
              error={spotsError}
              onCheck={(addr) => score(addr, "", "detail")}
            />

            <AffordableNearby
              work={work}
              result={areas}
              loading={areasLoading}
              error={areasError}
              onCheck={(addr) => score(addr, "", "detail")}
            />
          </div>

          <div className="col fill">
            <section>
              {/* The subtitle is not decoration: both sections in the left
                  column carry one, and without it this header is a line
                  shorter, so the map started 18px above their cards. */}
              <div className="section-head">
                <h2>Commute &amp; safety zone</h2>
                <p className="sub">Drive time and safety near your work.</p>
              </div>
              <ZoneMap
                center={workAt}
                height="fill"
                listings={mapListings}
                onCheck={(addr) => score(addr, "", "detail")}
                onAdd={openListing}
                slotsFull={slotsFull}
              />
            </section>
          </div>
            </div>
          </>
        )}
      </div>

      {signIn && <SignIn onClose={() => setSignIn(false)} />}

      {onboarding && (
        <Onboarding
          initialWork={work}
          initialPriorities={priorities}
          onDone={finishOnboarding}
          onCancel={work ? () => setOnboarding(false) : undefined}
        />
      )}
    </>
  );
}
