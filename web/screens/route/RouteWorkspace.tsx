/**
 * The Route screen (Main, and Phone at a narrow width) and the Fix route screen. One container for
 * both, because they are two views of the same car session: going from one to the other keeps the
 * form, the stops and their undo history.
 *
 * Data flow, the whole of it:
 *   URL → which car            useBatchCar (a batch row) or the EXAMPLE values (a typed car)
 *   session → CarReport        what is submitted, plus the stops
 *   useCarCheck(report)        the server's check: places, options, steps, verdict
 *   routeScene(check, option)  what the map draws
 */
import { useMemo, useState, type ReactElement } from "react";
import type { StopRef } from "../../../shared/cars.ts";
import type { RouteStrategy } from "../../../shared/route.ts";
import { go, hrefFor, linkTo, type Screen } from "../../app/routes.ts";
import { revertFix, saveAssumptions, saveFix, useBatchCar, useCarCheck, useShops } from "../../data/hooks.ts";
import { MapContent } from "../../map/MapStage.tsx";
import { routeScene, type MapScene, type SceneTarget } from "../../map/scene.ts";
import { PHONE_QUERY, useMedia } from "../../ui/media.ts";
import { DeltaBalloon, FixPanel, JunctionInspector, PickPrompt, WhichLine } from "./FixPanel.tsx";
import { RoutePanel } from "./RoutePanel.tsx";
import { useCarSession } from "./session.ts";

type RouteScreen = Extract<Screen, { name: "route" | "fix" }>;

export function RouteWorkspace({ screen }: { screen: RouteScreen }): ReactElement {
  const rowKey = screen.car.kind === "row" ? screen.car : null;
  const row = useBatchCar(rowKey);
  const shops = useShops();
  const car = useCarSession(screen.car, row);
  const { session, dispatch, asOf } = car;
  const fixing = screen.name === "fix";
  const compact = useMedia(PHONE_QUERY);

  // One way to get a verdict, for a typed car and a batch row, with stops and without.
  const check = useCarCheck(car.report && { report: car.report, asOf });
  const before = useCarCheck(fixing && car.baseline ? { report: car.baseline, asOf } : null);

  const result = check.status === "ready" ? check.data : null;
  const checked = result?.outcome === "checked" ? result : null;
  const beforeChecked = before.status === "ready" && before.data.outcome === "checked" ? before.data : null;

  // The option being looked at is view state, so it is in the URL; Fix route always works on the pick.
  const wanted = screen.name === "route" ? screen.option : null;
  const option = checked ? (checked.options.find((o) => o.id === wanted) ?? checked.options[0]) : null;
  // The turn-back being inspected belongs to the route before the stops: the stops are what removes it.
  const inspectedRoute = beforeChecked ?? checked;
  const inspected = fixing && screen.at !== null && inspectedRoute ? (inspectedRoute.options[0].turnBacks[screen.at] ?? null) : null;
  const stopsChanged = session.stops.past.length > 0;
  const hasStops = session.stops.present.length > 0;
  // "Keep" puts the balloon away until the stops change again.
  const [kept, setKept] = useState<StopRef[] | null>(null);

  const scene = useMemo((): MapScene | null => {
    if (!checked || !option) return null;
    const base = routeScene(checked, option.id, fixing && beforeChecked && hasStops ? beforeChecked.options[0] : null);
    const pending = session.lineChoice;
    if (!pending || base.kind !== "route") return base;
    // The node waiting for "Which line?" shows where the stop will go before it exists.
    return { ...base, pins: [...base.pins, { kind: "stop", glyph: "+", label: `Snaps to ${pending.near}`, position: [pending.lon, pending.lat], side: 1 }] };
  }, [checked, option, fixing, beforeChecked, hasStops, session.lineChoice]);

  // A typed stop goes in like a map click on that place; 5 km finds the node a code or a city stands for.
  const typedStop = (lon: number, lat: number) => void car.applyPick(lon, lat, 5, checked?.places ?? null);
  const fixScreen = (at: number | null): Screen => ({ name: "fix", car: screen.car, at });
  const routeScreen = (id: RouteStrategy | null): Screen => ({ name: "route", car: screen.car, option: id });
  const onSelect = (target: SceneTarget) => {
    if (target.kind === "option" && !fixing) go(routeScreen(target.id), { replace: true });
    if (target.kind === "turn-back") go(fixScreen(target.index));
  };

  // A batch row that is not there (a stale link, a deleted batch) or cannot be read must say so, not show an empty form.
  if (rowKey && row.status !== "ready") {
    return (
      <div className="route-panel">
        {row.status === "error" ? (
          <div className="error-card" role="alert">
            <p>This batch row could not be loaded. {row.error.message}</p>
            <div className="actions">
              <button type="button" className="btn" onClick={row.retry}>
                Try again
              </button>
              <a className="btn" {...linkTo({ name: "cars", batchId: null, car: null, shop: null, hide: [] })}>
                Back to Cars
              </a>
            </div>
          </div>
        ) : (
          <p className="panel-note" role="status">
            Loading the batch row…
          </p>
        )}
        <MapContent scene={null} focus={{ kind: "fit" }} />
      </div>
    );
  }

  return (
    <>
      {fixing ? (
        <FixPanel
          carKey={screen.car}
          carId={session.submitted.carId}
          now={checked}
          before={beforeChecked}
          at={screen.at}
          stops={hasStops ? (checked?.places.stops.map((stop) => stop.place) ?? []) : []}
          addingStop={session.pick === "stop"}
          unsaved={rowKey ? car.unsaved : null}
          batchName={row.status === "ready" ? row.data.batch.name : null}
          error={check.status === "error" ? check.error.message : null}
          onTypedStop={typedStop}
          onAddStop={() => dispatch({ type: "pick", target: session.pick === "stop" ? null : "stop" })}
          onRemoveStop={(index) => dispatch({ type: "removeStop", index })}
          onUseForRow={async () => {
            // The write refreshes every read, the row among them, so `unsaved` turns false by itself.
            if (!rowKey) return;
            if (session.stops.present.length) await saveFix(rowKey, session.stops.present);
            else await revertFix(rowKey);
          }}
        />
      ) : (
        <RoutePanel
          carKey={screen.car}
          draft={session.draft}
          places={result?.places ?? null}
          shops={shops.status === "ready" ? shops.data : []}
          pick={session.pick}
          dirty={car.dirty}
          positionAgeH={checked?.positionAgeH ?? null}
          compact={compact}
          dispatch={dispatch}
          check={check.status === "ready" ? { result: check.data, stale: check.stale } : null}
          error={check.status === "error" ? check.error.message : null}
          selected={option?.id ?? "pick"}
          onSelect={(id) => go(routeScreen(id), { replace: true })}
          onSaveAssumptions={saveAssumptions}
          onTypedStop={typedStop}
        />
      )}

      <MapContent
        scene={scene}
        focus={inspected ? { kind: "place", lon: inspected.at.lon, lat: inspected.at.lat, zoom: 14 } : { kind: "fit" }}
        forceTracks={fixing}
        onPick={session.pick ? (lon, lat, km) => void car.applyPick(lon, lat, km, checked?.places ?? null) : undefined}
        onSelect={onSelect}
        history={{
          undo: stopsChanged ? () => dispatch({ type: "undo" }) : null,
          redo: session.stops.future.length ? () => dispatch({ type: "redo" }) : null,
        }}
      >
        {!fixing && !session.pick && checked && (
          <div className="map-chip">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="chip-long">Planned route from the report · not live tracking</span>
            <span className="chip-short">
              <span className="mono strong">{session.submitted.carId || "Car"}</span> · not live
            </span>
          </div>
        )}
        {session.pick && <PickPrompt target={session.pick} missed={session.pickMissed} onCancel={() => dispatch({ type: "pick", target: null })} />}
        {session.lineChoice && <WhichLine node={session.lineChoice} onChoose={(railroad) => dispatch({ type: "lineChosen", railroad })} />}
        {inspected && <JunctionInspector turnBack={inspected} backHref={hrefFor(routeScreen(null))} />}
        {fixing && stopsChanged && hasStops && kept !== session.stops.present && option && beforeChecked && (
          <DeltaBalloon
            before={beforeChecked.options[0]}
            now={option}
            onKeep={() => {
              setKept(session.stops.present);
              go(fixScreen(null), { replace: true });
            }}
            onUndo={() => dispatch({ type: "undo" })}
          />
        )}
      </MapContent>
    </>
  );
}
