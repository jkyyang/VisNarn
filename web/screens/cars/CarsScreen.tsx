/**
 * The Cars screen: the morning list. The list is summaries only; the selected car's route is read
 * the same way the Route screen reads it (the row, then its check), so the two cannot disagree.
 */
import { useMemo, useState, type ReactElement } from "react";
import { go, hrefFor, type Screen } from "../../app/routes.ts";
import { removeBatch, useAssumptions, useBatchCar, useBatches, useBatchView, useCarCheck } from "../../data/hooks.ts";
import { MapContent } from "../../map/MapStage.tsx";
import { fleetScene } from "../../map/scene.ts";
import { atRiskText } from "../../words.ts";
import { CarCard, CarsPanel, UploadBatch } from "./CarsPanel.tsx";
import { groupCars } from "./list.ts";

type CarsScreenState = Extract<Screen, { name: "cars" }>;

export function CarsScreen({ screen }: { screen: CarsScreenState }): ReactElement {
  const batches = useBatches();
  const assumptions = useAssumptions();
  const [uploading, setUploading] = useState(false);

  // No batch in the URL: the newest one.
  const batchId = screen.batchId ?? (batches.status === "ready" ? (batches.data[0]?.id ?? null) : null);
  const view = useBatchView(batchId); // reads again while the server is still routing rows
  const cars = view.status === "ready" ? view.data.cars : null;

  const { hide, shop } = screen;
  const groups = useMemo(() => (cars ? groupCars(cars, { hide, shop }) : null), [cars, hide, shop]);

  // Until the user picks a row, show the most urgent one.
  const selectedRow = screen.car ?? cars?.[0]?.row ?? null;
  const selected = cars?.find((car) => car.row === selectedRow) ?? null;
  const row = useBatchCar(batchId !== null && selectedRow !== null ? { batchId, row: selectedRow } : null);
  const check = useCarCheck(row.status === "ready" ? { report: row.data.report, asOf: row.data.batch.asOf } : null);
  const checked = check.status === "ready" && check.data.outcome === "checked" ? check.data : null;

  const scene = useMemo(() => (cars ? fleetScene(cars, selectedRow, checked) : null), [cars, selectedRow, checked]);

  const at = (change: Partial<CarsScreenState>): Screen => ({ ...screen, batchId, ...change });
  const routeOf = (carRow: number): Screen => (batchId ? { name: "route", car: { kind: "row", batchId, row: carRow }, option: null } : screen);
  const fixOf = (carRow: number): Screen => (batchId ? { name: "fix", car: { kind: "row", batchId, row: carRow }, at: null } : screen);

  const upload = uploading && (
    <UploadBatch
      onCancel={() => setUploading(false)}
      onDone={(batch) => {
        setUploading(false);
        go({ name: "cars", batchId: batch.id, car: null, shop: null, hide: [] });
      }}
    />
  );

  if (view.status !== "ready" || !groups || batches.status !== "ready") {
    const failed = batches.status === "error" ? batches : view.status === "error" ? view : null;
    const empty = batches.status === "ready" && batches.data.length === 0;
    return (
      <div className="cars-panel">
        {failed ? (
          <div className="error-card" role="alert">
            <p>Couldn't load the car list. {failed.error.message}</p>
            <button type="button" className="btn" onClick={failed.retry}>
              Try again
            </button>
          </div>
        ) : empty ? (
          <div className="empty-state">
            <h1>No batch yet</h1>
            <p className="muted">Upload this morning's car list (CSV) to check every car at once.</p>
            <button type="button" className="btn btn--primary" onClick={() => setUploading(true)}>
              Upload batch
            </button>
          </div>
        ) : (
          <p className="panel-note" role="status">
            Loading the car list…
          </p>
        )}
        {upload}
        <MapContent scene={null} focus={{ kind: "fit" }} />
      </div>
    );
  }

  return (
    <>
      <CarsPanel
        batches={batches.data}
        view={view.data}
        groups={groups}
        filter={{ hide, shop }}
        selected={selectedRow}
        assumptions={assumptions.status === "ready" ? assumptions.data : null}
        hrefOf={(carRow) => hrefFor(routeOf(carRow))}
        atRiskText={() => (assumptions.status === "ready" ? atRiskText(view.data, shop ? view.data.cars.filter((car) => car.shop === shop) : view.data.cars, assumptions.data) : "")}
        onFilter={(filter) => go(at(filter), { replace: true })}
        onSelect={(carRow) => go(at({ car: carRow }), { replace: true })}
        onOpen={(carRow) => go(routeOf(carRow))}
        onFix={(carRow) => go(fixOf(carRow))}
        onSwitchBatch={(batch) => go({ name: "cars", batchId: batch.id, car: null, shop: null, hide: [] })}
        onUpload={() => setUploading(true)}
        onDeleteBatch={async (batch) => {
          await removeBatch(batch.id);
          go({ name: "cars", batchId: null, car: null, shop: null, hide: [] }, { replace: true });
        }}
      />
      {upload}
      <MapContent scene={scene} focus={{ kind: "fit" }} onSelect={(target) => target.kind === "car" && go(at({ car: target.row }), { replace: true })}>
        {selected && <CarCard car={selected} check={check.status === "ready" ? check.data : null} href={hrefFor(routeOf(selected.row))} />}
        <div className="map-chip map-chip--cars">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {view.data.batch.example && <span className="example-tag">EXAMPLE</span>}
          <span className="chip-long">Cars drawn at their next node (B), from the report · not live tracking</span>
          <span className="chip-short">At node B · not live</span>
        </div>
      </MapContent>
    </>
  );
}
