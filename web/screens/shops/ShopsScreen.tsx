/** The Shops screen: Your shops (one selected, the map on it), the form for one with its track links, and the shop list import. */
import { useEffect, useState, type ReactElement } from "react";
import { roundLngLat, type LngLat } from "../../../shared/geo.ts";
import { resolvedOf, SHOP_LINKS_MAX, type FraId, type LinkEnd, type ResolvedPlace, type ShopId, type ShopLink, type ShopView } from "../../../shared/places.ts";
import { useEscape } from "../../ui/useEscape.ts";
import { go, type Screen } from "../../app/routes.ts";
import { showSheet } from "../../app/sheet.ts";
import { fresh, importShops, removeShop, saveShop, shopLinkAt, useReadOnly, useShopLinks, useShops } from "../../data/hooks.ts";
import { SELECTED_ZOOM, SHOP_ZOOM } from "../../map/config.ts";
import type { MapHandle } from "../../map/MapHandles.tsx";
import { MapContent, type MapFlash } from "../../map/MapStage.tsx";
import { shopsScene, type SceneLink } from "../../map/scene.ts";
import { useDistanceUnit } from "../../units.ts";
import { linkJoinsThere, NO_TRACK_NEAR } from "../../words.ts";
import type { History } from "../route/session.ts";
import { ImportPreview, ShopForm, ShopLinks, ShopList, useImport } from "./ShopsPage.tsx";

/** A link being dragged: which (0-based, the next free one for a new link), and where its ring is. */
type Drag = { slot: number; at: LngLat };

const NO_SHOPS: ShopView[] = [];

/** Links nobody has changed here: the shop's saved ones. */
const UNCHANGED: History<FraId[] | null> = { past: [], present: null, future: [] };

export function ShopsScreen(props: {
  screen: Extract<Screen, { name: "shops" }>;
  /** What is typed in the panel's search: the list keeps the shops whose name or code has it. */
  query: string;
  selected: ShopId | null;
  onSelect: (id: ShopId) => void;
}): ReactElement {
  const { screen } = props;
  const shops = useShops();
  const readOnly = useReadOnly();
  const flow = useImport(importShops);
  const [unit] = useDistanceUnit();
  // View state of this screen, for the form it was made in: the links with their undo history (null: the saved ones),
  // the link whose ring is pressed (the next map tap sets it), a link being dragged, where the shop's pin is while it
  // is dragged and until its place resolves, why the last drop or tap set no link, the spot the pin was put on
  // (and whether by a drag), the form's place, and where the camera went.
  const [links, setLinks] = useState(UNCHANGED);
  const [pressed, setPressed] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pinAt, setPinAt] = useState<LngLat | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ at: LngLat; dragged: boolean } | null>(null);
  const [placed, setPlaced] = useState<ResolvedPlace | null>(null);
  const [camera, setCamera] = useState<LngLat | null>(null);
  const [flash, setFlash] = useState<MapFlash | undefined>(undefined);
  // Why the pin cannot stay where it was put (no track near): its edge turns red.
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setLinks(UNCHANGED);
    setPressed(null);
    setDrag(null);
    setPinAt(null);
    setRefused(null);
    setPicked(null);
    setPlaced(null);
  }, [screen.edit]);

  // A link to a shop that is gone (deleted, or never there) opens the list, and the address says so.
  const unknownShop =
    shops.status === "ready" && !shops.stale && screen.edit !== null && screen.edit !== "new" && !shops.data.some((shop) => shop.id === screen.edit);
  useEffect(() => {
    if (unknownShop) go({ name: "shops", edit: null }, { replace: true });
  }, [unknownShop]);

  useEscape(pressed !== null, () => setPressed(null));

  const list = shops.status === "ready" ? shops.data : [];
  const q = props.query.trim().toLowerCase();
  const listed = q ? list.filter((shop) => shop.name.toLowerCase().includes(q) || (shop.code ?? "").toLowerCase().includes(q)) : list;
  const selectedAt = resolvedOf(list.find((shop) => shop.id === props.selected)?.place);
  const editing = readOnly ? null : screen.edit === "new" ? "new" : (list.find((shop) => shop.id === screen.edit) ?? null);
  const shop = editing === "new" ? null : editing;
  const saved = shop && resolvedOf(shop.place);
  const place = placed ?? saved;
  const point: LngLat | null = place ? [place.lon, place.lat] : null;
  const atNode = place?.fraId != null;
  // The camera goes to the shop as it opens or is given a place; a pin dragged somewhere stays where it was let go.
  if (!picked?.dragged && camera?.join() !== point?.join()) setCamera(point);

  // The links: those set here, else the saved ones. With none, the suggestion is link 1 of a shop just placed (new, or
  // moved) and an offer to a saved shop where it is, so saving that one again never wires it. A shop at a node has none.
  const set = links.present ?? saved?.links?.map((link) => link.fraId) ?? [];
  const offering = !set.length && !atNode;
  const ends: LinkEnd[] = offering ? (point ? [{ lon: point[0], lat: point[1] }] : []) : set.map((fraId) => ({ fraId }));
  const answer = useShopLinks(point, ends);
  const suggestion = offering ? (fresh(answer)?.[0] ?? null) : null;
  const justPlaced = links.present === null && !!place && (place.lon !== saved?.lon || place.lat !== saved?.lat);
  const current = justPlaced && suggestion ? [suggestion.fraId] : set;
  const offer = current.length ? null : suggestion;
  // While a newer answer is on its way the last one still draws the links it has.
  const shown = answer.status === "ready" ? answer.data : [];
  const linkOf = (fraId: FraId): ShopLink | null => shown.find((link) => link?.fraId === fraId) ?? null;
  /** The other link that already joins this one's node, or -1. */
  const takenBy = (link: ShopLink, slot: number) => current.findIndex((fraId, i) => i !== slot && fraId === link.fraId);

  const preview = useShopLinks(point, drag && [{ lon: drag.at[0], lat: drag.at[1] }]);
  const target = drag && preview.status === "ready" ? preview.data[0] : undefined;
  const aimed = target && drag && takenBy(target, drag.slot) < 0 ? target : null;

  const header = <h1 className="visually-hidden">Your shops</h1>;

  if (shops.status !== "ready") {
    return (
      <div className="shops-screen">
        {header}
        {/* When they cannot be read, the page says so above every screen (web/app/App.tsx). */}
        {shops.status !== "error" && (
          <p className="panel-note" role="status">
            Loading your shops…
          </p>
        )}
        <MapContent scene={null} focus={{ kind: "fit" }} />
      </div>
    );
  }

  const close = () => go({ name: "shops", edit: null }, { replace: true });
  const change = (next: FraId[]) => {
    setRefused(null);
    if (next.join() !== current.join()) setLinks((history) => ({ past: [...history.past, history.present], present: next, future: [] }));
  };
  const travel = (step: "undo" | "redo") => {
    setRefused(null);
    setPressed(null);
    setLinks(({ past, present, future }) =>
      step === "undo" ? { past: past.slice(0, -1), present: past[past.length - 1], future: [present, ...future] } : { past: [...past, present], present: future[0], future: future.slice(1) },
    );
  };
  /** A drop or a tap at `at` for link `slot`: refined to the way in nearest it, refused with no track in reach or at the other link's node. */
  const setLink = async (slot: number, at: LngLat) => {
    if (!point) return;
    const link = await shopLinkAt(point, { lon: at[0], lat: at[1] }).catch(() => null);
    const other = link ? takenBy(link, slot) : -1;
    setDrag(null);
    if (!link || other >= 0) {
      setFlash({ at, kind: "miss", key: Date.now() });
      return setRefused(link ? linkJoinsThere(other + 1) : NO_TRACK_NEAR);
    }
    setFlash({ at: [link.lon, link.lat], kind: "hit", key: Date.now() });
    setPressed(null);
    change(current.toSpliced(slot, 1, link.fraId));
  };
  // A shop picked in the list or on the map: on a phone the sheet goes to half, its row over the map flown to.
  const select = (id: ShopId) => {
    showSheet("half");
    props.onSelect(id);
  };
  const press = (slot: number) => {
    setRefused(null);
    setPressed(pressed === slot ? null : slot);
    // On a phone the sheet lowers to its head, so the map can be tapped.
    if (pressed !== slot) showSheet("head");
  };
  /** What a link's ring (or the ＋, for the next free link) does on the map: dragged, it shows where it would join; tapped, it is pressed. */
  const gestures = (slot: number): Pick<MapHandle, "onDrag" | "onDrop" | "onPress"> => ({
    onPress: () => press(slot),
    onDrag: (at) => {
      setRefused(null);
      setDrag({ slot, at });
    },
    onDrop: (at) => (at ? void setLink(slot, at) : setDrag(null)),
  });
  const onPick = (lon: number, lat: number) => {
    if (!point) setPicked({ at: roundLngLat(lon, lat), dragged: false });
    else if (pressed !== null) void setLink(pressed, [lon, lat]);
  };

  // The map: the shop's pin, each link's ring and line, the ＋ for the next one; while a link is dragged, where it would join.
  const handles: MapHandle[] = [];
  const lines: SceneLink[] = [];
  // A pin put where no track is near stays there, red, until it is moved.
  const wrongAt = problem && picked ? picked.at : null;
  const pin = (at: LngLat): MapHandle => ({
    id: "shop",
    at,
    face: "shop",
    glyph: "",
    label: shop?.name ?? "New shop",
    wrong: problem,
    onDrag: (to) => setPinAt(to),
    onDrop: (to) => {
      setPinAt(to);
      if (to) setPicked({ at: roundLngLat(...to), dragged: true });
    },
  });
  if (editing && !point && wrongAt) handles.push(pin(pinAt ?? wrongAt));
  if (editing && point) {
    // While the pin moves, a link runs straight to its node; then along its own track again, from wherever the shop is now.
    const pathOf = (link: ShopLink): LngLat[] => (pinAt ? [pinAt, [link.lon, link.lat]] : [point, ...link.path.slice(1)]);
    const shopAt = pinAt ?? wrongAt ?? point;
    handles.push(pin(shopAt));
    current.forEach((fraId, slot) => {
      const link = linkOf(fraId);
      if (!link) return;
      const dragged = drag?.slot === slot;
      if (!dragged) lines.push({ path: pathOf(link), look: "set" });
      handles.push({ id: `link-${slot}`, at: dragged ? drag.at : [link.lon, link.lat], face: "link", glyph: String(slot + 1), label: `Move link ${slot + 1}`, pressed: pressed === slot, ...gestures(slot) });
    });
    if (offer) {
      const dragged = drag?.slot === 0;
      if (!dragged) lines.push({ path: pathOf(offer), look: "offered" });
      handles.push({ id: "offer", at: dragged ? drag.at : [offer.lon, offer.lat], face: "link", glyph: "1", label: "Suggested link 1", faint: true, ...gestures(0), onPress: () => change([offer.fraId]) });
    } else if (current.length < SHOP_LINKS_MAX) {
      handles.push({ id: "add", at: shopAt, face: "add", glyph: "+", label: "Add link", pressed: pressed === current.length, ...gestures(current.length) });
    }
    if (drag && target !== undefined) {
      lines.push(aimed ? { path: aimed.path, look: "ghost" } : { path: [point, drag.at], look: "refused" });
      if (aimed) handles.push({ id: "aim", at: [aimed.lon, aimed.lat], face: "link", glyph: String(drag.slot + 1), label: `Link ${drag.slot + 1} here` });
    }
  }

  const picking = !!editing && (!point || pressed !== null);

  return (
    <div className="shops-screen">
      {header}
      <div className="shops-body">
        {editing && (
          <ShopForm
            key={shop?.id ?? "new"}
            shop={shop}
            picked={picked?.at ?? null}
            onProblem={setProblem}
            history={{ what: "link change", undo: links.past.length ? () => travel("undo") : null, redo: links.future.length ? () => travel("redo") : null }}
            onPlace={(next) => {
              setPlaced(next);
              setPinAt(null);
            }}
            onSave={(draft) => saveShop({ ...draft, links: current }, shop?.id ?? null).then(close)}
            onDelete={shop ? () => removeShop(shop.id).then(close) : null}
            onCancel={close}
          >
            {point && (
              <ShopLinks
                links={current.map((fraId) => linkOf(fraId) ?? fraId)}
                offer={offer}
                unit={unit}
                pressed={pressed}
                refused={refused}
                onPress={press}
                onUse={() => offer && change([offer.fraId])}
                onRemove={(at) => change(current.toSpliced(at, 1))}
              />
            )}
          </ShopForm>
        )}
        <ImportPreview flow={flow} saved={list} />
        <ShopList
          shops={listed}
          total={list.length}
          selected={props.selected}
          editing={editing}
          lit={flow.saved?.ready ?? NO_SHOPS}
          onLit={flow.dismiss}
          onSelect={(shop) => select(shop.id)}
          onEdit={readOnly ? null : (shop) => (showSheet("half"), go({ name: "shops", edit: shop.id }))}
          onAdd={readOnly ? null : () => go({ name: "shops", edit: "new" })}
          onImport={readOnly ? null : flow.choose}
          importWrong={flow.preview ? null : flow.error}
        />
      </div>
      <MapContent
        scene={shopsScene(list, editing && point && { shopId: shop?.id ?? null, at: pinAt ?? point, links: lines }, props.selected)}
        focus={
          camera
            ? { kind: "place", lon: camera[0], lat: camera[1], zoom: SHOP_ZOOM }
            : selectedAt
              ? { kind: "place", lon: selectedAt.lon, lat: selectedAt.lat, zoom: SELECTED_ZOOM }
              : { kind: "fit" }
        }
        onPick={picking ? onPick : undefined}
        onSelect={picking ? undefined : (target) => target.kind === "place" && target.ref.kind === "shop" && select(target.ref.shopId)}
        handles={handles}
        flash={flash}
      />
    </div>
  );
}
