/** The Shops screen: Your shops, the form for one with its track links, and the shop list import. */
import { useEffect, useState, type ReactElement } from "react";
import { haversineKm, round5, type LngLat } from "../../../shared/geo.ts";
import { resolvedOf, SHOP_LINK_MAX_KM, type NetworkNode, type ResolvedPlace } from "../../../shared/places.ts";
import { useEscape } from "../../ui/useEscape.ts";
import { go, type Screen } from "../../app/routes.ts";
import { fresh, importShops, removeShop, saveShop, snapToNetwork, useShops, useWayIn } from "../../data/hooks.ts";
import { SHOP_ZOOM } from "../../map/config.ts";
import { MapContent } from "../../map/MapStage.tsx";
import { shopsScene } from "../../map/scene.ts";
import { useDistanceUnit } from "../../units.ts";
import { PickPrompt, ShopForm, ShopImportCard, ShopLinks, ShopTable } from "./ShopsPage.tsx";

/** What the map is being clicked for: the shop's own spot, or link `n` (0-based). */
type PickTarget = "shop" | number;

export function ShopsScreen({ screen }: { screen: Extract<Screen, { name: "shops" }> }): ReactElement {
  const shops = useShops();
  const [unit] = useDistanceUnit();
  // View state of this screen, for the form it was made in: what the map is clicked for, the spot picked,
  // the form's place, and the links once a person has set them here.
  const [picking, setPicking] = useState<PickTarget | null>(null);
  const [missed, setMissed] = useState(false);
  const [picked, setPicked] = useState<LngLat | null>(null);
  const [placed, setPlaced] = useState<ResolvedPlace | null>(null);
  const [wired, setWired] = useState<NetworkNode[] | null>(null);

  useEffect(() => {
    setPicking(null);
    setMissed(false);
    setPicked(null);
    setPlaced(null);
    setWired(null);
  }, [screen.edit]);

  // A link to a shop that is gone (deleted, or never there) opens the list, and the address says so.
  const unknownShop =
    shops.status === "ready" && !shops.stale && screen.edit !== null && screen.edit !== "new" && !shops.data.some((shop) => shop.id === screen.edit);
  useEffect(() => {
    if (unknownShop) go({ name: "shops", edit: null }, { replace: true });
  }, [unknownShop]);

  useEscape(picking !== null, () => setPicking(null));

  const list = shops.status === "ready" ? shops.data : [];
  const editing = screen.edit === "new" ? "new" : (list.find((shop) => shop.id === screen.edit) ?? null);
  const shop = editing === "new" ? null : editing;
  const saved = shop && resolvedOf(shop.place);
  const place = placed ?? saved;
  const point: LngLat | null = place ? [place.lon, place.lat] : null;
  const atNode = place?.fraId != null;
  // The links: those a person set here, else the saved ones. With none, the suggestion is link 1 of a shop
  // just placed (new, or moved), and an offer to a saved shop where it is, so saving that one again never wires it.
  const set = wired ?? saved?.links ?? [];
  const suggestion = fresh(useWayIn(set.length || atNode ? null : point)) ?? null;
  const justPlaced = !wired && !!place && (place.lon !== saved?.lon || place.lat !== saved?.lat);
  const fromShop = (node: NetworkNode): NetworkNode => (point ? { ...node, km: haversineKm(point[0], point[1], node.lon, node.lat) } : node);
  const links = (justPlaced && suggestion ? [suggestion] : set).map(fromShop);
  const offer = links.length ? null : suggestion;

  const header = <h1 className="visually-hidden">Your shops</h1>;

  if (shops.status !== "ready") {
    return (
      <div className="shops-screen">
        {header}
        {shops.status === "error" ? (
          <div className="alert" role="alert">
            <p>Couldn't load your shops. {shops.error.message}</p>
            <button type="button" className="btn" onClick={shops.retry}>
              Try again
            </button>
          </div>
        ) : (
          <p className="panel-note" role="status">
            Loading your shops…
          </p>
        )}
        <MapContent scene={null} focus={{ kind: "fit" }} />
      </div>
    );
  }

  const close = () => go({ name: "shops", edit: null }, { replace: true });
  const onPick = async (lon: number, lat: number) => {
    if (picking === "shop") {
      // The shop sits where it was clicked; its own track is what joins it to the network.
      setPicked([round5(lon), round5(lat)]);
      setPicking(null);
      return;
    }
    // A link joins a line's own track: the nearest such node to the click, as far as a link reaches.
    const node = await snapToNetwork(lon, lat, SHOP_LINK_MAX_KM, "mainline");
    setMissed(!node);
    if (!node || picking === null) return;
    setWired(links.toSpliced(picking, 1, node));
    setPicking(null);
  };
  const togglePick = (target: PickTarget) => {
    setMissed(false);
    setPicking((on) => (on === target ? null : target));
  };
  const linkEnds = [...links, ...(offer ? [offer] : [])].map((node) => ({ at: [node.lon, node.lat] as LngLat, suggested: node === offer }));

  return (
    <div className="shops-screen">
      {header}
      <div className={`shops-body${editing ? " has-form" : ""}`}>
        <ShopTable shops={list} editing={editing} onEdit={(shop) => go({ name: "shops", edit: shop.id })} onAdd={() => go({ name: "shops", edit: "new" })} />
        {editing && (
          <ShopForm
            key={shop?.id ?? "new"}
            shop={shop}
            unit={unit}
            picked={picked}
            picking={picking === "shop"}
            linked={links.length > 0}
            onTogglePick={() => togglePick("shop")}
            onPlace={setPlaced}
            onSave={(draft) => saveShop({ ...draft, links: links.map((node) => node.fraId) }, shop?.id ?? null).then(close)}
            onDelete={shop ? () => removeShop(shop.id).then(close) : null}
            onCancel={close}
          >
            {point && (
              <ShopLinks
                links={links}
                offer={offer}
                atNode={atNode}
                unit={unit}
                picking={typeof picking === "number" ? picking : null}
                onPick={togglePick}
                onUse={() => setWired([offer!])}
                onRemove={(at) => setWired(links.toSpliced(at, 1))}
              />
            )}
          </ShopForm>
        )}
      </div>
      <ShopImportCard run={importShops} />
      <MapContent
        scene={shopsScene(list, point && { label: shop?.name ?? "New shop", at: point, links: linkEnds })}
        focus={point ? { kind: "place", lon: point[0], lat: point[1], zoom: SHOP_ZOOM } : { kind: "fit" }}
        onPick={picking !== null ? (lon, lat) => void onPick(lon, lat) : undefined}
        onSelect={picking === null ? (target) => target.kind === "place" && target.ref.kind === "shop" && go({ name: "shops", edit: target.ref.shopId }) : undefined}
      >
        {picking !== null && <PickPrompt what={picking === "shop" ? "the shop" : `link ${picking + 1}`} missed={missed} onCancel={() => setPicking(null)} />}
      </MapContent>
    </div>
  );
}
