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
import { AccountMenu } from "./AccountMenu.tsx";
import { isSaved, persistSaved, removeSaved, toggleSaved } from "./saved.ts";
import { fetchSavedFromServer, fetchSession, signOut, type Account } from "./auth.ts";
import { addressIntent, forgetIntent, rememberIntent, takeIntent, type Intent } from "./pending.ts";
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
  const [account, setAccount] = useState<Account | null>(null);
  /** Whether this server has Google credentials at all -- the modal needs to know. */
  const [googleReady, setGoogleReady] = useState(false);
  /**
   * An error from the Google round trip. It comes back in the URL because the
   * browser was mid-navigation and there was no component left to hand it to.
   */
  const [authError, setAuthError] = useState<string | null>(null);

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
  /** Exactly one listing selected on Saved: its reality check owns the column. */
  const lone = pairFull ? null : (pair[0] ?? pair[1]);
  /**
   * Empty until an account says otherwise. Saving needs one, so signed out
   * there is genuinely nothing here rather than a list waiting to be claimed.
   */
  const [saved, setSaved] = useState<RealityCheck[]>([]);
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

  /** Whatever they were trying to do before being asked to sign in. */
  const runIntent = useCallback((intent: Intent) => {
    if (intent.kind === "open-saved") {
      setTab("saved");
      setDetail(null);
      setComparing(false);
      return;
    }
    setSaved((list) => toggleSaved(list, intent.check));
  }, []);

  /**
   * Load the account's saved listings, then finish what they came to do.
   *
   * Straight from the server, with nothing merged in: saving requires an
   * account, so a list in this browser could only be a leftover from someone
   * else's session, and folding that into whoever signs in next would hand
   * them another person's saves.
   *
   * The waiting intent runs after the list has arrived, so a save is applied
   * to the account's real list rather than to an empty one about to be
   * replaced by it.
   */
  const adopt = useCallback(
    async (user: Account) => {
      setAccount(user);
      setSaved((await fetchSavedFromServer()) ?? []);
      const intent = takeIntent(user.email);
      if (intent) runIntent(intent);
    },
    [runIntent],
  );

  /**
   * Do this now if they are signed in; otherwise ask them to sign in and do it
   * when they are. Everything that touches the saved list goes through here,
   * so there is one answer to "what happens if nobody is signed in".
   */
  function withAccount(intent: Intent) {
    if (account) {
      runIntent(intent);
      return;
    }
    rememberIntent(intent);
    setSignIn(true);
  }

  /**
   * Who is signed in, asked once. Also picks up the error a sign-in link or the
   * Google callback leaves in the URL, then takes it back out so a reload does
   * not replay it.
   *
   * Guarded rather than left to the dependency list, because this is not a
   * repeatable effect: it spends the waiting intent, and running it a second
   * time -- as StrictMode does in development -- would re-read the saved list
   * from the server while the save that intent just made was still in flight,
   * and show the reader a list one shorter than the one they have.
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const failed = params.get("authError");
    if (failed) {
      setAuthError(failed);
      setSignIn(true);
      params.delete("authError");
      const rest = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }

    void fetchSession().then((session) => {
      setGoogleReady(session.google);
      if (session.user) void adopt(session.user);
    });
  }, [adopt]);

  /**
   * Put a check in front of the reader, on whichever screen they are on.
   *
   * The board answers with its single-listing page. Saved has no separate
   * "opened" listing any more -- the right-hand column is whatever is
   * selected -- so showing something there means selecting just it.
   */
  function show(check: RealityCheck) {
    if (tab === "saved") {
      setPair([check, null]);
      return;
    }
    setDetail(check);
    window.scrollTo(0, 0);
  }

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
        show(check);
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
   * Saved listings are stored whole on the account and reopened rather than
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
      show(known);
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
          /* Signed out this is an invitation to sign in rather than a tab:
             there is no list to show, because there is nowhere to have saved
             anything to. */
          title={account ? undefined : "Sign in to save listings"}
          onClick={() => withAccount({ kind: "open-saved" })}
        >
          Saved{saved.length ? ` (${saved.length})` : ""}
        </button>
        <span className="spacer" />
        {account ? (
          <AccountMenu
            account={account}
            onChanged={setAccount}
            onSignOut={async () => {
              await signOut();
              forgetIntent();
              setAccount(null);
              /**
               * The list goes with the account -- it only ever lived on the
               * server, so there is nothing to clear here beyond the copy on
               * screen. Saved is not a place to be signed out on, so the tab
               * goes back to the board rather than showing an empty column.
               */
              setSaved([]);
              setPair([null, null]);
              setTab("check");
            }}
          />
        ) : (
          <button className="signin" onClick={() => setSignIn(true)}>Sign in</button>
        )}
      </nav>

      <div className="page">
        {tab === "saved" ? (
          <SavedPage
            saved={saved}
            pairFull={pairFull}
            /**
             * One click is the whole screen. Selecting a listing fills the
             * right-hand column with its reality check, selecting a second
             * turns that into the side-by-side breakdown, and clicking a
             * selected card again takes it back out -- dropping from two to
             * one leaves the survivor's reality check on screen.
             *
             * Opening and comparing used to be separate gestures, which meant
             * the column had two owners and a stray click on a card could wipe
             * a comparison. Now the selection is the only thing that decides
             * what the column shows.
             */
            onSelect={(c) => {
              const key = c.listing.address.trim().toLowerCase();
              const same = (x: RealityCheck | null) =>
                !!x && x.listing.address.trim().toLowerCase() === key;
              if (!pair.some(same)) void refreshSafety(c);
              setPair(([a, b]) => {
                if (same(a)) return [b, null];
                if (same(b)) return [a, null];
                if (!a) return [c, b];
                if (!b) return [a, c];
                /**
                 * Both places taken, and the faded cards are still clickable
                 * -- so they have to do something. The pair rolls: the older
                 * listing drops out and the new one is compared against
                 * whichever was selected most recently.
                 */
                return [b, c];
              });
            }}
            isSelected={(c) => {
              const key = c.listing.address.trim().toLowerCase();
              return pair.some((p) => !!p && p.listing.address.trim().toLowerCase() === key);
            }}
            /**
             * Two selected shows the breakdown, one shows that listing's
             * reality check, none leaves the map. The selection never touches
             * the board's own slots: this pair lives and dies on Saved.
             */
            detail={
              pair[0] && pair[1] ? (
                <ComparePage
                  inline
                  a={pair[0]}
                  b={pair[1]}
                  /** Narrow the selection to this one, and the column with it. */
                  onOpen={(c) => setPair([c, null])}
                  onRent={applyRent}
                  listings={mapListings}
                  onCheck={(addr) => score(addr, "", "detail")}
                  onAdd={openListing}
                />
              ) : lone ? (
                <RealityCheckPage
                  inline
                  check={lone}
                  saved={isSaved(saved, lone)}
                  onToggleSave={() => withAccount({ kind: "save", check: lone })}
                  onRent={(rent) => applyRent(lone, rent)}
                  listings={mapListings}
                  onCheck={(addr) => score(addr, "", "detail")}
                  onAdd={openListing}
                />
              ) : undefined
            }
            /** Unsaving drops it from the comparison too -- a listing that is
                no longer in the list cannot go on owning the column. */
            onRemove={(c) => {
              const key = c.listing.address.trim().toLowerCase();
              const same = (x: RealityCheck | null) =>
                !!x && x.listing.address.trim().toLowerCase() === key;
              setPair(([a, b]) => [same(a) ? null : a, same(b) ? null : b]);
              setSaved((list) => removeSaved(list, c));
            }}
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
            onToggleSave={() => withAccount({ kind: "save", check: detail })}
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

      {signIn && (
        <SignIn
          onClose={() => {
            setSignIn(false);
            setAuthError(null);
            forgetIntent();
          }}
          googleReady={googleReady}
          initialError={authError}
          /* So a waiting intent can be matched to the address the link went
             to, and not finished by someone else on this browser. */
          onRequested={addressIntent}
        />
      )}

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
