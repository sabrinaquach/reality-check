import { useCallback, useEffect, useMemo, useState } from "react";
import { AddListing } from "./AddListing.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { PlacesNearWork } from "./PlacesNearWork.tsx";
import { QuietNearby, type QuietSpot } from "./QuietNearby.tsx";
import { RealityCheckPage } from "./RealityCheckPage.tsx";
import { SavedPage } from "./SavedPage.tsx";
import { ZoneMap, type MapListing } from "./ZoneMap.tsx";
import { SignIn } from "./SignIn.tsx";
import { isSaved, loadSaved, persistSaved, removeSaved, toggleSaved } from "./saved.ts";
import { Slot } from "./Slot.tsx";
import { icons } from "./icons.ts";
import type { Priority, RealityCheck } from "./types.ts";

const ONBOARDING_KEY = "reality-check.onboarding";

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
  const [saved, setSaved] = useState<RealityCheck[]>(loadSaved);
  const [tab, setTab] = useState<"check" | "saved">("check");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setSlots(([a, b]) => {
          if (target === 0) return [check, b];
          if (target === 1) return [a, check];
          return a === null ? [check, b] : [a, check];
        });
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
  async function addRent(rent: number) {
    if (!detail) return;
    const res = await fetch("/api/cost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ check: detail, rent }),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as RealityCheck;
    const key = updated.listing.address.trim().toLowerCase();
    const same = (c: RealityCheck | null) =>
      !!c && c.listing.address.trim().toLowerCase() === key;

    setDetail(updated);
    setSlots(([a, b]) => [same(a) ? updated : a, same(b) ? updated : b]);
    setSaved((list) => {
      const next = list.map((c) => (same(c) ? updated : c));
      if (next.some((c) => same(c))) persistSaved(next);
      return next;
    });
  }

  function openListing(address: string) {
    const key = address.trim().toLowerCase();
    const known = [...slots, ...saved].find(
      (c): c is RealityCheck => !!c && c.listing.address.trim().toLowerCase() === key,
    );
    if (known) {
      setDetail(known);
      window.scrollTo(0, 0);
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
          onClick={() => { setTab("check"); setDetail(null); }}
        >
          Check a listing
        </button>
        <button
          className={tab === "saved" ? "navlink on" : "navlink"}
          onClick={() => { setTab("saved"); setDetail(null); }}
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
            slotsFull={slotsFull}
            onOpen={(c) => { setTab("check"); setDetail(c); window.scrollTo(0, 0); }}
            onAdd={(c) => {
              setSlots(([a, b]) => (a === null ? [c, b] : b === null ? [a, c] : [a, b]));
              setTab("check");
              window.scrollTo(0, 0);
            }}
            onRemove={(c) => setSaved((list) => removeSaved(list, c))}
            onBrowse={() => setTab("check")}
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

        <div className="layout">
          <div className="slots">
              <Slot
                ordinal="1st"
                check={slots[0]}
                onClear={() => setSlots(([, b]) => [null, b])}
                onDropAddress={(a) => score(a, "", 0)}
              />
              <span className="vs">vs</span>
              <Slot
                ordinal="2nd"
                check={slots[1]}
                onClear={() => setSlots(([a]) => [a, null])}
                onDropAddress={(a) => score(a, "", 1)}
              />
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
              onPick={(addr) => setAddress(addr)}
            />
          </div>

          <div className="col fill">
            <section>
              <div className="section-head">
                <h2>Commute &amp; safety zone</h2>
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
