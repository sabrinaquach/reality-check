import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { icons } from "./icons.ts";
import type { Route } from "./types.ts";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

type Layer = "commute" | "safety";

type Block = {
  address: string;
  incidents: number;
  score: number;
  band: "good" | "moderate" | "poor";
  lng: number;
  lat: number;
};

/**
 * The same three bands the safety pillar reports, in the same words and the
 * same colours the score and bars use elsewhere. The server scores each block
 * through the pillar's own pipeline, so "Good" here means exactly what "Good"
 * means on a listing's card -- not a separate scale invented for the map.
 */
/** The hour the commute pillar routes for, in the format the API wants. */
function nextWeekdayMorning(): string {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Drive-time rings around the centre, from Mapbox's Isochrone API. This is
 * what makes Commute mean something on the board map, where there is no single
 * route to draw -- the panel is called "Commute & safety zone", and a zone is
 * exactly what an isochrone is.
 */
const COMMUTE_BANDS = [
  { minutes: 15, opacity: 0.3 },
  { minutes: 30, opacity: 0.2 },
  { minutes: 45, opacity: 0.12 },
] as const;

const BANDS = [
  { key: "good", label: "Good", color: "#3f8f63", blurb: "scores 60 or above, like a listing marked Good" },
  { key: "moderate", label: "Moderate", color: "#b5822a", blurb: "scores 30 to 59" },
  { key: "poor", label: "Poor", color: "#c05442", blurb: "scores below 30" },
] as const;

/**
 * "500 COLEMAN AV" -> "Coleman Ave". A band can hold hundreds of blocks and
 * many are the same street at different block numbers, so the list groups by
 * street: far fewer rows, and each one answers "which streets are these?"
 * rather than making the reader collate house numbers themselves.
 */
function streetOf(address: string): string {
  return pretty(address.replace(/^\s*\d+\s+/, ""));
}

/** SJPD publishes block addresses in caps. */
const pretty = (a: string) =>
  a.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bAv\b/, "Ave");

/**
 * Google's encoded polyline format. The route arrives on the same Directions
 * response as the drive time, so drawing it costs no extra API call.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const which of ["lat", "lng"] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === "lat") lat += delta;
      else lng += delta;
    }
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}

/**
 * Mapbox throws "Style is not done loading" from addSource/addLayer until the
 * style has actually finished, and its "styledata" event fires well before
 * that. Anything that adds to the map goes through here, so an early arrival
 * waits for the next idle instead of throwing.
 *
 * This is not tidiness. An uncaught throw inside an effect unmounts the whole
 * React tree, so a mistimed overlay took the entire page down with it -- which
 * is exactly what happened when the map was swapped out from under itself by
 * picking a second listing to compare.
 */
function whenStyleReady(m: mapboxgl.Map, add: () => void) {
  const run = () => {
    try {
      add();
    } catch {
      // The map is still usable without this overlay; a blank page is not.
    }
  };
  if (m.isStyleLoaded()) run();
  else m.once("idle", run);
}

export type MapListing = {
  address: string;
  lat: number;
  lng: number;
  rent: number | null;
  score: number | null;
  band: "good" | "moderate" | "poor" | null;
  kind: "saved" | "compared";
};

export function ZoneMap({
  center,
  route,
  height = 337,
  listings = [],
  onCheck,
  onAdd,
  slotsFull = false,
}: {
  center: { lat: number; lng: number } | null;
  route?: Route;
  /** A fixed pixel height, or "fill" to take whatever the column leaves. */
  height?: number | "fill";
  /** Listings the user already has: saved ones and whatever is in the slots. */
  listings?: MapListing[];
  /** Run a full reality check on an address picked off the map. */
  onCheck?: (address: string) => void;
  /** Open the reality check for a listing tapped on the map. */
  onAdd?: (address: string) => void;
  /** Unused by the callout now, kept for the block list's Check action. */
  slotsFull?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [layer, setLayer] = useState<Layer>(route ? "commute" : "safety");
  const [failed, setFailed] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  // The blocks layer arrives asynchronously, after the visibility effect has
  // already run. Without this the heatmap is added hidden and never revealed.
  const [layersAdded, setLayersAdded] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [band, setBand] = useState<number | null>(null);
  const [picked, setPicked] = useState<{ address: string; rent: number | null } | null>(null);
  const [showAll, setShowAll] = useState(false);
  /** Extent of each drive-time ring, keyed by minutes, so each can be framed. */
  const isoBounds = useRef<Record<number, [[number, number], [number, number]]>>({});

  /**
   * Depend on the coordinates, never on the object holding them.
   *
   * A caller writing center={{ lat, lng }} inline hands over a fresh object
   * every render. With the object in the dependency list the init effect tore
   * the map down and rebuilt it each time, which re-rendered, which built it
   * again -- an unbounded loop that blanks the page. Primitives make the
   * identity of the caller's object irrelevant.
   */
  const lat = center?.lat ?? null;
  const lng = center?.lng ?? null;

  useEffect(() => {
    if (!TOKEN || !center || !host.current || map.current) return;
    /**
     * A fresh map starts unready, whatever the last one managed.
     *
     * This effect rebuilds the map when the centre moves, but `ready` is state
     * and survives that -- so the new map inherited the old one's `true`, and
     * every effect waiting on it fired immediately against a style that had
     * not loaded. addSource throws there, and an uncaught throw in an effect
     * unmounts the page.
     */
    setReady(false);
    mapboxgl.accessToken = TOKEN;
    try {
      const m = new mapboxgl.Map({
        container: host.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: [center.lng, center.lat],
        zoom: 12.5,
        attributionControl: true,
      });
      m.on("error", (e) => setFailed(e.error?.message ?? "Map failed to load."));

      // Hanging everything off "load" alone is fragile: it never fires under
      // software WebGL, and a slow device can leave the map blank forever with
      // no explanation. Take the first of several signals, and say something
      // if none of them arrive.
      //
      // But "styledata" fires while the style is still loading, and everything
      // downstream of `ready` adds sources to the map -- which throws until it
      // is genuinely done. So the signals only *prompt* a check, and the check
      // is the real gate. `on` rather than `once`: an early styledata must not
      // consume the only chance to notice.
      const markReady = () => {
        if (m.isStyleLoaded()) setReady(true);
      };
      if (m.isStyleLoaded()) setReady(true);
      else {
        m.on("load", markReady);
        m.on("idle", markReady);
        m.on("styledata", markReady);
      }
      map.current = m;
    } catch (e) {
      setFailed((e as Error).message);
    }
    const timer = setTimeout(() => setSlow(true), 12_000);
    return () => {
      clearTimeout(timer);
      map.current?.remove();
      map.current = null;
    };
  }, [lat, lng]);

  useEffect(() => {
    if (ready) setSlow(false);
  }, [ready]);

  // Sources and layers, once the style is up.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !center) return;

    new mapboxgl.Marker({ color: "#e8a8a0" }).setLngLat([center.lng, center.lat]).addTo(m);

    /**
     * The drawn commute, and the last piece that used to trust `ready` alone.
     *
     * `ready` is state, so resetting it when the map is rebuilt does not reach
     * effects already queued in the same commit -- they still close over the
     * old `true` and run against a style that has not loaded. Opening a saved
     * listing does exactly that: the centre moves, the map is rebuilt, and
     * this effect fires with a route to draw. Asking the map itself is the
     * only check that cannot be stale.
     */
    if (route && !m.getSource("route")) {
      const coords = decodePolyline(route.polyline);
      whenStyleReady(m, () => {
        m.addSource("route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
        });
        m.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#e8a8a0", "line-width": 5, "line-opacity": 0.9 },
        });
        m.fitBounds(
          [
            [route.bounds.west, route.bounds.south],
            [route.bounds.east, route.bounds.north],
          ],
          { padding: 48, duration: 0 },
        );
        setLayersAdded((n) => n + 1);
      });
    }

    // Severity-weighted incidents, drawn as density rather than dots -- one
    // block is noise, a cluster of them is the thing worth seeing.
    let cancelled = false;
    fetch(`/api/blocks?lat=${center.lat}&lng=${center.lng}&radius=2`)
      .then((r) => r.json())
      .then((geo) => {
        if (cancelled || !map.current || map.current.getSource("blocks")) return;
        const m2 = map.current;
        whenStyleReady(m2, () => {
        m2.addSource("blocks", { type: "geojson", data: geo });
        m2.addLayer({
          id: "safety-heat",
          type: "heatmap",
          source: "blocks",
          layout: { visibility: "none" },
          paint: {
            // Calibrated against the real spread near downtown San Jose:
            // median block weight 6, p95 66, max 704. Ramping to 300 (a guess)
            // put the typical block at 0.02 and drew nothing at all. Topping
            // out near p95 lets ordinary streets register while the worst
            // blocks still saturate.
            /**
             * Hot means a worse safety score, so the heat and the bands read
             * the same way round.
             *
             * The falloff is steep on purpose. Near downtown, 961 of 1,218
             * blocks land in Poor, and a gentle ramp made every one of them
             * contribute heavily -- the map went solid red and stopped
             * distinguishing anything. Weight now drops off fast above a score
             * of about 15, so a genuinely concentrated pocket glows while the
             * merely-below-average surroundings stay cool.
             */
            "heatmap-weight": [
              "interpolate", ["linear"], ["get", "score"],
              0, 1,
              15, 0.45,
              30, 0.16,
              50, 0.05,
              100, 0,
            ],
            "heatmap-intensity": 0.7,
            "heatmap-radius": 20,
            "heatmap-opacity": 0.7,
            // Stays transparent longer, so low density reads as "nothing
            // notable here" rather than a wash of colour.
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(0,0,0,0)",
              0.15, "rgba(63,143,99,0.35)",
              0.4, "#b5822a",
              0.7, "#c05442",
              1, "#8c2f22",
            ],
          },
        });
        // A second layer over the same source: the heat shows where, this shows
        // which, once someone picks a band from the legend.
        m2.addLayer({
          id: "blocks-points",
          type: "circle",
          source: "blocks",
          layout: { visibility: "none" },
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 9],
            "circle-color": [
              "match", ["get", "band"],
              "good", BANDS[0].color,
              "moderate", BANDS[1].color,
              BANDS[2].color,
            ],
            "circle-stroke-width": 1,
            "circle-stroke-color": "rgba(0,0,0,0.35)",
            "circle-opacity": 0.95,
          },
        });
        setLayersAdded((n) => n + 1);
        });

        setBlocks(
          (geo.features ?? []).map((f: any) => ({
            address: f.properties.address,
            incidents: f.properties.incidents,
            score: f.properties.score,
            band: f.properties.band,
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          })),
        );
      })
      .catch(() => {
        /* the map still works without the overlay */
      });
    return () => {
      cancelled = true;
    };
  }, [ready, lat, lng, route]);

  useEffect(() => {
    if (route) setLayer("commute");
  }, [route]);

  // Drive-time rings. One request per location, and the result is layered
  // largest-first by the API so the rings nest correctly.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || lat === null || lng === null || !TOKEN) return;
    if (m.getSource("iso")) return;

    let cancelled = false;
    // driving-traffic with the same next-weekday-8am departure the commute
    // pillar routes for, so the rings and the scores describe the same trip.
    fetch(
      `https://api.mapbox.com/isochrone/v1/mapbox/driving-traffic/${lng},${lat}` +
        `?contours_minutes=${COMMUTE_BANDS.map((b) => b.minutes).join(",")}` +
        `&polygons=true&denoise=1&depart_at=${nextWeekdayMorning()}` +
        `&access_token=${TOKEN}`,
    )
      .then((r) => r.json())
      .then((geo) => {
        if (cancelled || !map.current || map.current.getSource("iso")) return;
        if (!geo?.features?.length) return;
        // At street zoom the whole viewport sits inside the 15-minute ring, so
        // all three fills cover everything and read as a flat wash. Remember
        // the extent so selecting Commute can frame the rings.
        for (const feat of geo.features) {
          let minX = 180, minY = 90, maxX = -180, maxY = -90;
          for (const ring of feat.geometry.coordinates ?? []) {
            for (const [x, y] of ring as [number, number][]) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
          if (maxX > minX) isoBounds.current[feat.properties.contour] = [[minX, minY], [maxX, maxY]];
        }

        const m2 = map.current;
        whenStyleReady(m2, () => {
        m2.addSource("iso", { type: "geojson", data: geo });
        m2.addLayer(
          {
            id: "iso-fill",
            type: "fill",
            source: "iso",
            layout: { visibility: "none" },
            paint: {
              "fill-color": "#e8a8a0",
              "fill-opacity": [
                "match", ["get", "contour"],
                ...COMMUTE_BANDS.flatMap((b) => [b.minutes, b.opacity]),
                0.12,
              ],
            },
          },
          // Under the route line and the listing dots, so those stay readable.
          m.getLayer("route-line") ? "route-line" : undefined,
        );
        m2.addLayer({
          id: "iso-line",
          type: "line",
          source: "iso",
          layout: { visibility: "none" },
          paint: { "line-color": "#dd968d", "line-width": 1, "line-opacity": 0.7 },
        });
        setLayersAdded((n) => n + 1);
        });
      })
      .catch(() => {
        /* the commute route still draws without the rings */
      });
    return () => {
      cancelled = true;
    };
  }, [ready, lat, lng]);

  /**
   * The user's own listings, drawn over whichever overlay is showing. These
   * are the only "listings" the app actually knows about -- there is no rental
   * feed -- so they are plotted from what has already been scored.
   */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    const data = {
      type: "FeatureCollection" as const,
      features: listings.map((l) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [l.lng, l.lat] },
        properties: {
          address: l.address,
          rent: l.rent ?? -1,
          score: l.score ?? -1,
          band: l.band ?? "none",
          kind: l.kind,
        },
      })),
    };

    const existing = m.getSource("listings") as mapboxgl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
      return;
    }

    whenStyleReady(m, () => {
    m.addSource("listings", { type: "geojson", data });
    m.addLayer({
      id: "listings-halo",
      type: "circle",
      source: "listings",
      paint: {
        "circle-radius": 13,
        "circle-color": "#ffffff",
        "circle-opacity": 0.9,
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(0,0,0,0.15)",
      },
    });
    m.addLayer({
      id: "listings-dot",
      type: "circle",
      source: "listings",
      paint: {
        "circle-radius": 8,
        "circle-color": [
          "match", ["get", "band"],
          "good", BANDS[0].color,
          "moderate", BANDS[1].color,
          "poor", BANDS[2].color,
          "#8b8b8b",
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
    m.addLayer({
      id: "listings-label",
      type: "symbol",
      source: "listings",
      layout: {
        "text-field": ["case", [">=", ["get", "score"], 0], ["to-string", ["get", "score"]], ""],
        "text-size": 10,
        "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
        "text-allow-overlap": true,
      },
      paint: { "text-color": "#ffffff" },
    });
    });

    m.on("click", "listings-dot", (e) => {
      const p = (e.features?.[0] as { properties?: { address?: string; rent?: number } } | undefined)
        ?.properties;
      if (p?.address) setPicked({ address: p.address, rent: p.rent && p.rent > 0 ? p.rent : null });
    });

    // Tapping the map itself dismisses the bar; the design has no close control.
    m.on("click", (e) => {
      const hits = m.queryRenderedFeatures(e.point, { layers: ["listings-dot"] });
      if (!hits.length) setPicked(null);
    });
    m.on("mouseenter", "listings-dot", () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", "listings-dot", () => (m.getCanvas().style.cursor = ""));
    setLayersAdded((n) => n + 1);
  }, [ready, listings]);

  /**
   * Growing the container does not tell Mapbox its canvas changed, so it keeps
   * rendering at the old size. Waiting a frame after the class change was a
   * guess and measured wrong -- the layout had not been applied yet. Watching
   * the element instead is exact, and also covers window resizes.
   */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => map.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
    // Depends on the coordinates: until they arrive this component renders a
    // placeholder instead of the canvas, so with an empty dependency list the
    // effect ran once against a null ref and never again.
  }, [lat, lng]);

  /**
   * A second, explicit resize when the size actually changes. The observer
   * above is the proper mechanism, but it is not delivered everywhere, and the
   * failure mode -- a map rendering at its old canvas size inside a much
   * larger box -- looks exactly like a broken map. Two frames: the first lets
   * the new layout apply, the second measures it.
   */
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => map.current?.resize());
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [expanded]);

  // Escape closes the expanded map, and the page behind it should not scroll.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  // Toggling the pills just flips layer visibility.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const set = (id: string, on: boolean) => {
      if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    set("route-line", layer === "commute");
    set("iso-fill", layer === "commute");
    set("iso-line", layer === "commute");

    // Frame whatever Commute is showing: the route if there is one, otherwise
    // the drive-time rings, which are useless if their edges are off-screen.
    if (layer === "commute") {
      if (route) {
        m.fitBounds(
          [
            [route.bounds.west, route.bounds.south],
            [route.bounds.east, route.bounds.north],
          ],
          { padding: 48, duration: 600 },
        );
      } else {
        const widest = isoBounds.current[COMMUTE_BANDS[COMMUTE_BANDS.length - 1]!.minutes];
        if (widest) m.fitBounds(widest, { padding: 40, duration: 600 });
      }
    }
    set("safety-heat", layer === "safety");
    // Picking a band swaps the density for the individual blocks in it.
    const filtering = layer === "safety" && band !== null;
    set("blocks-points", filtering);
    if (filtering && m.getLayer("blocks-points")) {
      m.setFilter("blocks-points", ["==", ["get", "band"], BANDS[band]!.key]);
      m.setLayoutProperty("safety-heat", "visibility", "none");
    }
    // Your own listings narrow to the same band, so "my saved places in poor
    // areas" is one click.
    for (const id of ["listings-halo", "listings-dot", "listings-label"]) {
      if (!m.getLayer(id)) continue;
      m.setFilter(id, filtering ? ["==", ["get", "band"], BANDS[band]!.key] : null);
    }
  }, [layer, band, ready, layersAdded]);

  if (!TOKEN) {
    return (
      <div className="empty map" style={height === "fill" ? undefined : { minHeight: height }}>
        <strong>Map needs a Mapbox token</strong>
        Add <code>VITE_MAPBOX_TOKEN=pk.…</code> to <code>web/.env</code> and restart{" "}
        <code>npm run dev</code>. The commute and safety numbers are already real; this only
        draws them.
      </div>
    );
  }

  if (!center) {
    return (
      <div className="empty map" style={height === "fill" ? undefined : { minHeight: height }}>
        <strong>Nothing to centre on yet</strong>
        Set a workplace or check a listing.
      </div>
    );
  }

  /**
   * The scrim and the placeholder are siblings, never parents.
   *
   * Wrapping the map in the scrim when it expands changes the map div's
   * position in the tree, so React unmounts and remounts it -- and Mapbox is
   * left holding a detached node, which is why the map went dead after a
   * round trip. Keeping this div at a fixed position in the children array
   * means the same DOM node survives, and expanding is purely CSS.
   */
  return (
    <>
      {expanded && <div className="zone-scrim" onClick={() => setExpanded(false)} role="presentation" />}
      {expanded && (
        <div className="zone-placeholder" style={height === "fill" ? { flex: 1 } : { height }} />
      )}
      <div
        className={`zone${expanded ? " expanded" : ""}${height === "fill" ? " fill" : ""}`}
        style={expanded || height === "fill" ? undefined : { height }}
        data-ready={ready ? "yes" : "no"}
        data-layer={layer}
      >
      <div className="zone-canvas" ref={host} />
      {failed && <div className="zone-error">{failed}</div>}
      {!failed && slow && !ready && (
        <div className="zone-error">
          The map is taking a while to start. This usually means WebGL is unavailable or
          blocked in this browser.
        </div>
      )}

      <div className="zone-pills">
        {(["commute", "safety"] as Layer[]).map((k) => (
          <button
            key={k}
            className={layer === k ? "zone-pill on" : "zone-pill"}
            onClick={() => setLayer(k)}
          >
            {k[0]!.toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      {layer === "commute" && (
        <div className="zone-legend">
          <p className="zone-legend-title">Drive time from here</p>
          {COMMUTE_BANDS.map((b) => (
            <button
              className="zone-band"
              key={b.minutes}
              title={`Zoom to the ${b.minutes}-minute area`}
              onClick={() => {
                const bounds = isoBounds.current[b.minutes];
                if (bounds) map.current?.fitBounds(bounds, { padding: 40, duration: 700 });
              }}
            >
              <span
                className="sw"
                style={{ background: `rgba(232, 168, 160, ${b.opacity + 0.25})` }}
              />
              <span className="lbl">Within {b.minutes} min</span>
            </button>
          ))}
          {route && (
            <div className="zone-band static">
              <span className="sw line" />
              <span className="lbl">This commute</span>
            </div>
          )}
        </div>
      )}

      {layer === "safety" && blocks.length > 0 && (
        <div className="zone-legend">
          <p className="zone-legend-title">Safety score, same as a listing's</p>
          {BANDS.map((b, i) => {
            const count = blocks.filter((x) => x.band === b.key).length;
            return (
              <button
                key={b.label}
                className={band === i ? "zone-band on" : "zone-band"}
                disabled={count === 0}
                aria-pressed={band === i}
                title={`${b.blurb} — click to list them`}
                onClick={() => {
                  const next = band === i ? null : i;
                  setBand(next);
                  setShowAll(false);
                  if (next !== null && !expanded) setExpanded(true);
                  // Frame the blocks in that band, so clicking the legend takes
                  // you to them rather than leaving you to hunt for the colour.
                  if (next !== null) {
                    const inBand = blocks.filter((x) => x.band === b.key);
                    if (inBand.length) {
                      const lngs = inBand.map((x) => x.lng);
                      const lats = inBand.map((x) => x.lat);
                      map.current?.fitBounds(
                        [
                          [Math.min(...lngs), Math.min(...lats)],
                          [Math.max(...lngs), Math.max(...lats)],
                        ],
                        { padding: 60, duration: 700, maxZoom: 15 },
                      );
                    }
                  }
                }}
              >
                <span className="sw" style={{ background: b.color }} />
                <span className="lbl">{b.label}</span>
                <span className="cnt">{count}</span>
              </button>
            );
          })}
          {band !== null && (
            <button className="zone-band clear" onClick={() => setBand(null)}>
              Show all as heat
            </button>
          )}
        </div>
      )}

      {layer === "safety" && band !== null && (() => {
        const inBand = blocks.filter((b) => b.band === BANDS[band]!.key);

        // One row per street, not per block.
        const byStreet = new Map<string, typeof inBand>();
        for (const b of inBand) {
          const street = streetOf(b.address);
          const list = byStreet.get(street);
          if (list) list.push(b);
          else byStreet.set(street, [b]);
        }

        // Lead with the most extreme end of whichever band this is: the worst
        // streets when looking at Poor, the best when looking at Good.
        const best = BANDS[band]!.key === "good";
        const groups = [...byStreet.entries()]
          .map(([street, items]) => {
            const sorted = [...items].sort((a, b) => a.score - b.score);
            return {
              street,
              items: sorted,
              lead: best ? sorted[sorted.length - 1]! : sorted[0]!,
              low: sorted[0]!.score,
              high: sorted[sorted.length - 1]!.score,
              incidents: items.reduce((n, x) => n + x.incidents, 0),
            };
          })
          // Many streets share the same extreme score, so a tie falls back to
          // size -- a long stretch matters more than a single block.
          .sort(
            (a, b) =>
              (best ? b.lead.score - a.lead.score : a.lead.score - b.lead.score) ||
              b.items.length - a.items.length,
          );

        const LIMIT = 12;
        const shown = showAll ? groups : groups.slice(0, LIMIT);

        return (
          <div className="zone-list">
            <div className={`zone-list-head ${BANDS[band]!.key}`}>
              <div>
                <strong>{BANDS[band]!.label} areas</strong>
                <span>
                  {groups.length} street{groups.length === 1 ? "" : "s"} · {inBand.length} block
                  {inBand.length === 1 ? "" : "s"}
                </span>
              </div>
              <button onClick={() => setBand(null)} aria-label="Close list">×</button>
            </div>

            <ul>
              {shown.map((g) => (
                <li key={g.street}>
                  <button
                    className="zone-street"
                    title="Zoom to this street"
                    onClick={() => {
                      const lngs = g.items.map((x) => x.lng);
                      const lats = g.items.map((x) => x.lat);
                      map.current?.fitBounds(
                        [
                          [Math.min(...lngs), Math.min(...lats)],
                          [Math.max(...lngs), Math.max(...lats)],
                        ],
                        { padding: 80, duration: 700, maxZoom: 16 },
                      );
                    }}
                  >
                    <span className="a">{g.street}</span>
                    <span className="n">
                      {g.items.length > 1 && <>{g.items.length} blocks · </>}
                      {/* A range says more than one end of it. */}
                      {g.low === g.high ? `${g.low}` : `${g.low}\u2013${g.high}`}/100 ·{" "}
                      {g.incidents} incident{g.incidents === 1 ? "" : "s"}
                    </span>
                  </button>
                  {onCheck && (
                    <button
                      className="zone-check"
                      title={`Run a reality check on ${pretty(g.lead.address)}`}
                      onClick={() => {
                        setExpanded(false);
                        onCheck(`${pretty(g.lead.address)}, San Jose`);
                      }}
                    >
                      Check
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {groups.length > LIMIT && (
              <button className="zone-more" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${groups.length} streets`}
              </button>
            )}
          </div>
        );
      })()}

      {picked && (
        <div className="picked-bar">
          <div className="picked-text">
            <span className="picked-addr">{picked.address}</span>
            <span className="picked-rent">
              {picked.rent ? (
                <>
                  <b>$ {picked.rent.toLocaleString()}</b>
                  <span> / mo</span>
                </>
              ) : (
                <span>No rent given</span>
              )}
            </span>
          </div>
          <button
            className="picked-add"
            disabled={!onAdd}
            title="Open this listing's reality check"
            onClick={() => {
              setExpanded(false);
              onAdd?.(picked.address);
              setPicked(null);
            }}
          >
            Check listing
          </button>
        </div>
      )}

      <button
        className="zone-expand"
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? "Close expanded map" : "Expand map"}
        title={expanded ? "Close (Esc)" : "Expand map"}
        aria-expanded={expanded}
      >
        {/*
          No minimize glyph exists in the Figma file, so rather than draw one
          the expanded state reuses the cross the modals close with.
        */}
        <img
          className={expanded ? "glyph glyph-close" : "glyph glyph-open"}
          src={expanded ? icons.cross : icons.expand}
          alt=""
        />
        </button>
      </div>
    </>
  );
}
