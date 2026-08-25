# Reality Check — scoring spike

No UI, no dependencies. Node 22.6+ runs the TypeScript directly.

```bash
npm run build-index          # once: builds data/blocks.json from SJPD open data (~3 min)
npm run score -- "300 E Santa Clara St, San Jose" \
  --to "Apple Park, Cupertino" --rent 2800 --priorities safety,commute
npm run check                # scoring-curve assertions, offline
```

## Pillars

| Pillar | Source | Key needed |
| --- | --- | --- |
| Commute | Google Directions, weekday 8am with traffic | `GOOGLE_MAPS_API_KEY` |
| Safety | SJPD calls for service, severity-weighted per block | none |
| Cost | Census ACS 5-year median rent for the tract | `CENSUS_API_KEY` |
| Amenities | Google Places, distance to nearest of six kinds | `GOOGLE_MAPS_API_KEY` |

Every pillar is 0–100 where higher is better. A pillar that cannot get real
data reports itself `unavailable` rather than guessing, and drops out of the
composite; below 50% of the weight, the composite itself returns `null`.

## Weighting

Commute, safety and cost carry equal base weight; amenities carry 0.6. The
priorities a renter picks multiply their pillar by 2.5 / 1.75 / 1.25 in the
order given, then everything is renormalised over the pillars that answered.

## Known limits

- The safety index holds the top 4,000 blocks by weighted incidents, geocoded
  via the Census batch API at ~80% match. Intersections ("1ST ST & SANTA CLARA
  ST") are skipped entirely.
- Outside SJPD's jurisdiction there is no data, so safety reports unavailable
  rather than scoring a silent 100.
- ACS medians include long-standing leases, so they sit below today's asking
  rents; the cost curve is calibrated for that, but it is a calibration, not a
  market feed.
