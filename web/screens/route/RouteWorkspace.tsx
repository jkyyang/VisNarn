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
import { MapContent } from "../../map/MapStage.tsx";
import { chosenRoute, planScene, type SceneTarget } from "../../map/scene.ts";
import { RoutePanel } from "./RoutePanel.tsx";
import { insertIndex, isFull, usePlanSession } from "./session.ts";

const NO_SHOPS: ShopView[] = [];

export function RouteWorkspace({ screen }: { screen: Extract<Screen, { name: "route" }> }): ReactElement {
  const list = useSavedRoutes();
  const savedRoutes = list.status === "ready" ? list.data : [];
  const saved = screen.saved ? (savedRoutes.find((route) => route.id === screen.saved) ?? null) : null;
  const { session, dispatch, clickMap, clickPlace } = usePlanSession(screen.saved, saved);
  const plan = session.plan.present;
  const empty = plan.start === null && plan.destination === null && plan.stops.length === 0;
  const planned = usePlannedRoute(empty ? null : plan);
  const shops = useShops();
  const [clickError, setClickError] = useState<string | null>(null);

  const result = planned.status === "ready" ? planned.data : null;
  const places = result?.places ?? null;
  // The alternative is view state, in the URL; a saved route opens on the one saved with it.
  const option = screen.option ?? saved?.option ?? null;
  const chosen = result?.outcome === "routed" ? chosenRoute(result.routes, option) : null;
  const shopList = shops.status === "ready" ? shops.data : NO_SHOPS;
  const scene = useMemo(() => planScene({ planned: result, option, shops: shopList }), [result, option, shopList]);

  // A link to a saved route that is gone (deleted, or never there) opens a new plan instead.
  const known = list.status === "ready" && !list.stale;
  useEffect(() => {
    if (screen.saved && known && !saved) go(HOME, { replace: true });
  }, [screen.saved, known, saved]);

  const onSelect = (target: SceneTarget) => {
    if (target.kind === "option") go({ ...screen, option: target.id }, { replace: true });
    else clickPlace(target.ref, target.position, places);
  };

  const onSave = async (name: string, routeString: string) => {
    if (!isFull(plan) || !chosen) return;
    const route = await saveRoute({ name, plan, option: chosen.strategies[0], routeString }, screen.saved);
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
      />
      <MapContent
        scene={scene}
        focus={{ kind: "fit" }}
        onPick={(lon, lat, km) => {
          setClickError(null);
          clickMap(lon, lat, km, places).catch((error: unknown) => setClickError(error instanceof Error ? error.message : "The click could not be placed."));
        }}
        onSelect={onSelect}
        placeActions={[
          { label: "Set as start", run: (found) => dispatch({ type: "setPlace", field: "start", ref: found.ref }) },
          { label: "Add as stop", run: (found) => dispatch({ type: "addStop", ref: found.ref, index: insertIndex(plan, places, found) }) },
          { label: "Set as destination", run: (found) => dispatch({ type: "setPlace", field: "destination", ref: found.ref }) },
        ]}
        history={{
          undo: session.plan.past.length ? () => dispatch({ type: "undo" }) : null,
          redo: session.plan.future.length ? () => dispatch({ type: "redo" }) : null,
        }}
      />
    </>
  );
}
