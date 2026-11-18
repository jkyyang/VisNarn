# VisNARN: v1 scope (draft, 2026-11-16)

Status: **proposed**, waiting for answers to the questions in "Step 0". Nothing here is agreed with the team yet.

## The problem in one sentence
Before a railcar reaches one of our repair shops, the shop must finish preprocessing (repair prep).
We want to flag cars that may **arrive before prep ends**, early enough to act.

## v1 in one sentence
A local tool that reads a CSV export of cars heading to our shops, estimates arrival with an
**uncertainty band fitted from our own history**, and lists the cars whose prep may end too late, most at risk first.

## Step 0: questions before any more build work (calendar time)
Ask the data owner:
1. **Do we already have an ETA?** Does Synapse/CPS store a railroad- or Railinc-provided ETA, or past arrival/placement events per car?
   If yes, v1 becomes "existing ETA vs prep end + a fitted shop-delivery delay", and most routing work is not needed.
2. **What does a car position look like?** 10–20 masked rows: location code, code type (SPLC / FSAC / station name + state / internal / FRA node), reporting railroad, timestamp with time zone.
   Car location messages often give the last station and the destination. Confirm that a next node exists.
3. **Is there a station master table** (CSM / FSAC / SPLC with lat/lon) in Synapse/CPS? (Railinc CSM is licensed; do not rebuild it from public data.)
4. **Shop list:** shop code, name, location, serving railroad (and short line, if any).
5. **Where does prep_end live,** and which event counts as "arrived at shop" (arrival at serving yard, constructive placement, or actual placement)?
6. **May car locations leave the team** (for a demo to Michael)? Until answered: real data stays on the laptop; shared pages use EXAMPLE rows only.

Ask one shop planner:
7. **How often does a car arrive before prep is done today, and what does it cost?** How do they learn arrival dates now?

## Milestones
| # | Milestone | Done when | Effort |
|---|---|---|---|
| M0 | Step 0 answered | Answers to 1–7 written down; Michael has OK'd the timebox (5-minute ask) | ~0 build days, 1–2 weeks calendar |
| M1 | Real codes resolve | Every code in a full day's export resolves to a graph node or is listed by name as unresolved; each shop has a checked node + serving railroad | 0.25 day (coords/FRA in DB) to 3+ days (codes without coords) |
| M2 | Evidence spike (backtest) | On 50–100 completed shop trips: effective km/day distribution (P10/P50/P90), the P10-based verdict vs a naive historical-median baseline, miss rate and false-alarm rate | 3–5 days |
| M3 | Demo to Michael | One sentence with real numbers (e.g. "would have flagged N of M late preps last quarter"), what is faked, the ask | 1 day |

**Hard stop rules:** stop after M1 if fewer than half of codes can be located; stop after M2 if the band is too wide to change any prep decision.
Timebox: one day per week at most, so the Troubleshooting Card is not slowed down.

## In scope for v1
- Done: Class I graph, railroad-aware router with via points, batch CSV in/out (`src/lib`).
- **Label fixes (small, do now):**
  - Stop calling the current window "earliest/latest arrival". Today both bounds use one fixed speed; it only covers where the car is between A and B. Label it "estimate at placeholder speed" until M2.
  - Time zones: reject or explicitly parse timestamps without an offset (currently read in the browser's local zone).
  - Every output shows which assumptions produced it ("placeholder" or "calibrated on N trips").
  - Unresolved codes and off-network shops show "cannot check", never "good".
- Code lookup layer with a `match_method / confidence` column (path depends on code type, see research notes).
- Shop table with a hand-checked node and serving railroad per shop, plus a **destination dwell** term (yard + local switch + placement, often 1–3 days).
- Backtest script (headless, reuses `router.ts` / `arrival.ts`) and the **P10/P50/P90 band**; verdict compares prep end with P10 minus buffer.
- UI: freeze at what is being finished now (batch table, one-car form, map). No more polish in v1.

## Explicitly out of v1
- Real-time tracking; general A-to-B trip planning; the animated-map video.
- ADF/Synapse daily job, DSP module, hosting, logins, alerts (only after Michael says yes).
- Live database connection (CSV export only).
- Short lines / industry spurs in the graph (handled per shop by hand).
- Train schedules, blocking plans, per-yard dwell models, machine learning ETA.
- Saving via-point fixes per lane; a one-week coworker trial; editing the network.
- Buying SPLC/CSM data or scraping it.
- Publishing real car data anywhere.

## Decisions that belong to the team
| Decision | Recommendation |
|---|---|
| Who runs it day to day | The analyst runs a morning batch and sends the at-risk list to shops |
| Which percentile the verdict uses (P5 / P10 / P20) and the buffer in hours | Set with a shop planner after M2, based on the cost of a miss vs a false alarm |
| Timebox | ~1 day/week, M3 demo date fixed in advance, stop if Michael says no |
| Where real data may be shown | Laptop only until the data owner confirms |

## Research notes (2026-11-16, from public sources)
- Public network-average car velocity is about 200–225 mi/day (≈320–360 km/day; CN, UP), so the 400 km/day placeholder is likely too fast. Terminal dwell ≈7–11 h per terminal (CN, CSX). Railroad averages exclude bad-order and stored cars, so shop-bound cars likely move slower. Sources: cn.ca key weekly metrics, investors.csx.com key service measures, STB EP 724 rail service data.
- Location codes: Railinc CSM (keyed by SCAC+FSAC, has SPLC + lat/lon) is the industry master and is licensed. NMFTA sells SPLC. Free BTS layers have no SPLC/FSAC except 241 intermodal terminals. Free fallbacks: NTAD Rail Yards (name + railroad + county), NTAD Rail Mileposts (subdivision + milepost), Census places, GeoNames. City-name geocoding measured ≈5.5 km median / 13 km p90 error on 216 terminals.
- ETA method: compute ratio r = actual hours / model hours on past trips; report model × r at P10/P50/P90; fall back lane → region → global when a group has fewer than ~50 trips. Backtest with a time split; report coverage, miss rate, false-alarm rate, and MAE vs a historical-median baseline.
