/** The small marks every screen shares: status pills, railroad chips, the estimate badge, the assumption chips. */
import { useId, useState, type FormEvent, type ReactElement } from "react";
import { RAILROADS, type Railroad } from "../../shared/railroads.ts";
import type { Assumptions } from "../../shared/assumptions.ts";
import { assumptionChips, basisWords, PILL_LABELS, type Pill } from "../words.ts";
import { shapeMarkup, type ShapeName } from "./shapes.ts";

/** One status shape, coloured by the CSS class of its status. */
export function Shape(props: { name: ShapeName; size?: number }): ReactElement {
  const size = props.size ?? 14;
  return (
    <svg className={`shape shape--${props.name}`} width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" dangerouslySetInnerHTML={{ __html: shapeMarkup(props.name) }} />
  );
}

/** A status as word + shape + colour: octagon (at risk), triangle (tight), circle (on time), square (check route), dash (cannot check). */
export function StatusPill(props: { pill: Pill; margin?: string; size?: "small" | "large" }): ReactElement {
  return (
    <span className={`pill pill--${props.pill}${props.size ? ` pill--${props.size}` : ""}`} data-pill={props.pill}>
      <Shape name={props.pill} size={props.size === "small" ? 12 : 14} />
      {PILL_LABELS[props.pill]}
      {props.margin && <span className="mono">{props.margin}</span>}
    </span>
  );
}

/** A railroad's colour dot and code. */
export function RailroadChip(props: { railroad: Railroad }): ReactElement {
  return (
    <span className="rr-chip" data-railroad={props.railroad}>
      <span className="rr-swatch" style={{ background: `var(--rr-${props.railroad})` }} aria-hidden="true" />
      {props.railroad}
    </span>
  );
}

/** "Rough estimate" while the speed is a placeholder; "Calibrated on N trips" after. */
export function BasisBadge(props: { basis: Assumptions["timing"]["basis"] }): ReactElement {
  return <span className={`basis basis--${props.basis.kind}`}>{basisWords(props.basis)}</span>;
}

/** A number field of the assumptions editor; the text is kept as typed until Save. */
function NumberField(props: { label: string; unit: string; value: string; onChange: (value: string) => void }): ReactElement {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <span className="with-unit">
        <input id={id} inputMode="decimal" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
        <span className="unit">{props.unit}</span>
      </span>
    </div>
  );
}

type Draft = Record<"speed" | "delay" | "buffer" | "penalty" | "detour" | "age", string>;

const draftOf = (a: Assumptions): Draft => ({
  speed: String(a.timing.speedKmPerDay),
  delay: String(a.timing.interchangeDelayH),
  buffer: String(a.timing.bufferH),
  penalty: String(a.routing.interchangePenaltyKm),
  detour: String(a.flags.detourRatio),
  age: String(a.flags.positionAgeH),
});

/**
 * "Assumes 400 km/day placeholder · +24 h per interchange · buffer 24 h". The chips open the editor
 * (speed, delay, buffer, interchange penalty, railroads allowed, flag thresholds); saving re-times
 * every car, and re-routes only when a routing number changed.
 */
export function AssumptionChips(props: { assumptions: Assumptions; onSave: (next: Assumptions) => Promise<unknown> }): ReactElement {
  const { assumptions } = props;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(assumptions));
  const [allowed, setAllowed] = useState<Railroad[]>(assumptions.routing.allowed);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editorId = useId();

  const start = () => {
    setDraft(draftOf(assumptions));
    setAllowed(assumptions.routing.allowed);
    setError(null);
    setOpen(true);
  };
  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const n = (text: string) => Number(text.trim().replace(",", "."));
    const values = { speed: n(draft.speed), delay: n(draft.delay), buffer: n(draft.buffer), penalty: n(draft.penalty), detour: n(draft.detour), age: n(draft.age) };
    if (Object.values(draft).some((text) => text.trim() === "") || Object.values(values).some((v) => !Number.isFinite(v))) {
      setError("Every box needs a number.");
      return;
    }
    const next: Assumptions = {
      routing: { allowed: RAILROADS.filter((r) => allowed.includes(r)), interchangePenaltyKm: values.penalty },
      timing: { ...assumptions.timing, speedKmPerDay: values.speed, interchangeDelayH: values.delay, bufferH: values.buffer },
      flags: { detourRatio: values.detour, positionAgeH: values.age },
    };
    setSaving(true);
    setError(null);
    try {
      await props.onSave(next);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the assumptions.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="assumptions">
      <div className="chip-row">
        <span className="muted small">Assumes</span>
        {assumptionChips(assumptions).map((chip) => (
          <button key={chip} type="button" className="assume-chip" aria-expanded={open} aria-controls={editorId} onClick={() => (open ? setOpen(false) : start())}>
            {chip}
          </button>
        ))}
      </div>
      {open && (
        <form id={editorId} className="assume-editor" aria-label="Edit assumptions" onSubmit={submit}>
          <p className="muted small">Placeholders until they are fitted from car history. Saving re-checks every car.</p>
          <div className="assume-grid">
            <NumberField label="Speed" unit="km/day" value={draft.speed} onChange={set("speed")} />
            <NumberField label="Delay per interchange" unit="h" value={draft.delay} onChange={set("delay")} />
            <NumberField label="Buffer before arrival" unit="h" value={draft.buffer} onChange={set("buffer")} />
            <NumberField label="Interchange penalty (routing)" unit="km" value={draft.penalty} onChange={set("penalty")} />
            <NumberField label="Detour worth a look above" unit="×" value={draft.detour} onChange={set("detour")} />
            <NumberField label="Report is old after" unit="h" value={draft.age} onChange={set("age")} />
          </div>
          <fieldset className="rr-allowed">
            <legend>Railroads allowed</legend>
            {RAILROADS.map((railroad) => (
              <label key={railroad} className="check">
                <input
                  type="checkbox"
                  checked={allowed.includes(railroad)}
                  onChange={(e) => setAllowed((list) => (e.target.checked ? [...list, railroad] : list.filter((r) => r !== railroad)))}
                />
                <RailroadChip railroad={railroad} />
              </label>
            ))}
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Saving…" : "Save assumptions"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
