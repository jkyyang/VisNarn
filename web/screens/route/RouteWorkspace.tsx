/**
 * The route planner: a new plan, or a saved route opened for editing. Data flow, the whole of it:
 *   URL → which saved route, which alternative     useSavedRoutes
 *   session → Plan                                  the places, with undo and redo
 *   usePlannedRoute(plan)                           the server's routes between them
 *   planScene(...)                                  what the map draws
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { ShopView } from "../../../shared/places.ts";
import { go, HOME, type Screen } from "../../app/routes.ts";
import { removeRoute, saveRoute, usePlannedRoute, useSavedRoutes, useShops } from "../../data/hooks.ts";
import { MapContent, type MapFlash } from "../../map/MapStage.tsx";
import { chosenRoute, planScene, type SceneTarget } from "../../map/scene.ts";
import { useEscape } from "../../ui/useEscape.ts";
import { useDistanceUnit } from "../../units.ts";
import { errorText } from "../../words.ts";
import { RoutePanel } from "./RoutePanel.tsx";
import { fullPlan, insertIndex, isEmpty, placeAtEnd, usePlanSession } from "./session.ts";

const NO_SHOPS: ShopView[] = [];

export function RouteWorkspace({ screen }: { screen: Extract<Screen, { name: "route" }> }): ReactElement {
  const list = useSavedRoutes();
  const savedRoutes = list.status === "ready" ? list.data : [];
  const saved = screen.saved ? (savedRoutes.find((route) => route.id === screen.saved) ?? null) : null;
  const { session, dispatch, clickMap, clickPlace } = usePlanSession(screen.saved, saved);
  const plan = session.plan.present;
  const planned = usePlannedRoute(isEmpty(plan) ? null : plan);
  const shops = useShops();
  const [clickError, setClickError] = useState<string | null>(null);
  const [flash, setFlash] = useState<MapFlash | undefined>(undefined);
  const [unit] = useDistanceUnit();

  const result = planned.status === "ready" ? planned.data : null;
  const places = result?.places ?? null;
  // The alternative is view state, in the URL; a saved route opens on the one saved with it.
  const option = screen.option ?? saved?.option ?? null;
  const chosen = result?.outcome === "routed" ? chosenRoute(result.routes, option) : null;
  const shopList = shops.status === "ready" ? shops.data : NO_SHOPS;
  // The leg picked in the panel or on the map; a new route, or Esc, lets go of it.
  const [leg, setLeg] = useState<number | null>(null);
  useEffect(() => setLeg(null), [chosen]);
  useEscape(leg !== null, () => setLeg(null));
  const scene = useMemo(() => planScene({ planned: result, option, leg, shops: shopList, unit }), [result, option, leg, shopList, unit]);

  // A link to a saved route that is gone (deleted, or never there) opens a new plan instead.
  const known = list.status === "ready" && !list.stale;
  useEffect(() => {
    if (screen.saved && known && !saved) go(HOME, { replace: true });
  }, [screen.saved, known, saved]);

  const onSelect = (target: SceneTarget) => {
    if (target.kind === "option") go({ ...screen, option: target.id }, { replace: true });
    else if (target.kind === "leg") setLeg(leg === target.index ? null : target.index);
    else clickPlace(target.ref, target.position, places);
  };

  const onSave = async (name: string, routeString: string) => {
    const full = fullPlan(plan);
    if (!full || !chosen) return;
    const route = await saveRoute({ name, plan: full, option: chosen.strategies[0], routeString }, screen.saved);
    if (screen.saved) return;
    // The session keeps its undo history under the new id; the URL now names the saved route.
    dispatch({ type: "saved", id: route.id });
    go({ name: "route", saved: route.id, option: screen.option }, { replace: true });
  };

  const onNew = () => {
    if (screen.saved) go(HOME);
    else {
      dispatch({ type: "clear" });
      if (screen.option) go(HOME, { replace: true });
    }
  };

  return (
    <>
      <RoutePanel
        session={session}
        dispatch={dispatch}
        planned={result ? { result, stale: planned.status === "ready" && planned.stale } : null}
        error={planned.status === "error" ? planned.error.message : clickError}
        selected={option}
        onSelect={(id) => go({ ...screen, option: id }, { replace: true })}
        saved={savedRoutes}
        open={saved}
        onSave={onSave}
        onRemoveSaved={async (id) => void (await removeRoute(id))}
        onNew={onNew}
        unit={unit}
        history={{
          what: "route change",
          undo: session.plan.past.length ? () => dispatch({ type: "undo" }) : null,
          redo: session.plan.future.length ? () => dispatch({ type: "redo" }) : null,
        }}
        leg={leg}
        onLeg={setLeg}
      />
      <MapContent
        scene={scene}
        focus={{ kind: "fit" }}
        include={plan.include}
        onPick={(lon, lat, km, line) => {
          setClickError(null);
          setLeg(null);
          // The stop snaps to the line clicked: a grey route, else the selected one.
          const onLine = result?.outcome === "routed" ? chosenRoute(result.routes, line ?? option) : null;
          clickMap(lon, lat, km, places, onLine?.legs.map((leg) => leg.path) ?? null).then(
            (at) => at !== undefined && setFlash({ at: at ?? [lon, lat], kind: at ? "hit" : "miss", key: Date.now() }),
            (error: unknown) => setClickError(errorText(error, "The click could not be placed.")),
          );
        }}
        onSelect={onSelect}
        flash={flash}
        placeActions={[
          { label: "Start", run: (found) => dispatch(placeAtEnd(plan, "start", found.ref)) },
          { label: "Add stop", run: (found) => dispatch({ type: "insert", at: insertIndex(plan, places, found), ref: found.ref }) },
          { label: "Destination", run: (found) => dispatch(placeAtEnd(plan, "destination", found.ref)) },
        ]}
      />
    </>
  );
}
