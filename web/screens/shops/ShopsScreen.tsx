/** The Shops screen: Your shops, the form for one, and the shop list import. */
import { useEffect, useState, type ReactElement } from "react";
import type { NetworkNode } from "../../../shared/places.ts";
import { BackHeader } from "../../app/chrome.tsx";
import { go, HOME, type Screen } from "../../app/routes.ts";
import { importShops, removeShop, saveShop, snapToNetwork, useMeta, useShops } from "../../data/hooks.ts";
import { MapContent } from "../../map/MapStage.tsx";
import { shopsScene } from "../../map/scene.ts";
import { PickPrompt, ShopForm, ShopImportCard, ShopTable } from "./ShopsPage.tsx";

export function ShopsScreen({ screen }: { screen: Extract<Screen, { name: "shops" }> }): ReactElement {
  const meta = useMeta();
  const shops = useShops();
  // Picking the shop's location on the map: view state of this screen.
  const [picking, setPicking] = useState(false);
  const [missed, setMissed] = useState(false);
  // A pick belongs to the form it was made for, so it carries which form that was.
  const [picked, setPicked] = useState<{ edit: string; node: NetworkNode } | null>(null);
  const editKey = String(screen.edit);
  const pickedHere = picked?.edit === editKey ? picked.node : null;

  useEffect(() => {
    setPicking(false);
    setMissed(false);
  }, [screen.edit]);

  // A link to a shop that is gone (deleted, or never there) opens the list, and the address says so.
  const unknownShop =
    shops.status === "ready" && !shops.stale && screen.edit !== null && screen.edit !== "new" && !shops.data.some((shop) => shop.id === screen.edit);
  useEffect(() => {
    if (unknownShop) go({ name: "shops", edit: null }, { replace: true });
  }, [unknownShop]);

  useEffect(() => {
    if (!picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  const header = (
    <BackHeader
      back={HOME}
      title="Your shops"
      exampleOnly={meta.status === "ready" && meta.data.exampleOnly}
    />
  );

  if (shops.status !== "ready") {
    return (
      <div className="shops-screen">
        {header}
        {shops.status === "error" ? (
          <div className="error-card" role="alert">
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

  const list = shops.data;
  const editing = screen.edit === "new" ? "new" : (list.find((shop) => shop.id === screen.edit) ?? null);
  const close = () => go({ name: "shops", edit: null }, { replace: true });
  // The shop being edited, where the map should show it: a node just picked, or where it is saved.
  const saved = editing && editing !== "new" && editing.place.ok ? editing.place.place : null;
  const editingAt = pickedHere
    ? { label: `Picked: ${pickedHere.near}`, lon: pickedHere.lon, lat: pickedHere.lat }
    : saved && { label: "Editing this shop", lon: saved.lon, lat: saved.lat };
  const onPick = async (lon: number, lat: number, toleranceKm: number) => {
    const node = await snapToNetwork(lon, lat, toleranceKm);
    if (!node) {
      setMissed(true);
      return;
    }
    setPicked({ edit: editKey, node });
    setMissed(false);
    setPicking(false);
  };

  return (
    <div className="shops-screen">
      {header}
      <div className={`shops-body${editing ? " has-form" : ""}`}>
        <ShopTable shops={list} editing={editing} onEdit={(shop) => go({ name: "shops", edit: shop.id })} onAdd={() => go({ name: "shops", edit: "new" })} />
        {editing && (
          <ShopForm
            key={editing === "new" ? "new" : editing.id}
            shop={editing === "new" ? null : editing}
            picked={pickedHere}
            picking={picking}
            onTogglePick={() => {
              setMissed(false);
              setPicking((on) => !on);
            }}
            onSave={(draft) => saveShop(draft, editing === "new" ? null : editing.id).then(close)}
            onDelete={editing === "new" ? null : () => removeShop(editing.id).then(close)}
            onCancel={close}
          />
        )}
      </div>
      <ShopImportCard run={importShops} />
      <MapContent
        scene={shopsScene(list, editingAt)}
        focus={pickedHere ? { kind: "place", lon: pickedHere.lon, lat: pickedHere.lat, zoom: 11 } : editingAt ? { kind: "place", lon: editingAt.lon, lat: editingAt.lat, zoom: 9 } : { kind: "fit" }}
        onPick={picking ? (lon, lat, km) => void onPick(lon, lat, km) : undefined}
      >
        {picking && <PickPrompt missed={missed} onCancel={() => setPicking(false)} />}
      </MapContent>
    </div>
  );
}
