/**
 * A finger has no hover: a tap on something marked wrong (a red edge, a red mark) shows its tooltip, why,
 * next to it until the next tap. The tap still does what it does. Screen readers already hear why.
 */
import { useEffect, useState, type ReactElement } from "react";

/** What is marked wrong and says why in its title. */
const WRONG = '.is-wrong[title], .is-off[title], [title]:has([aria-invalid="true"])';
/** Room the tip needs under what was tapped; with less, it goes above. */
const ROOM_PX = 72;

export function WhyTip(): ReactElement | null {
  const [tip, setTip] = useState<{ text: string; top: number; above: boolean } | null>(null);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const wrong = event.pointerType === "mouse" ? null : (event.target as Element).closest?.<HTMLElement>(WRONG);
      if (!wrong?.title) return setTip(null);
      const box = wrong.getBoundingClientRect();
      const above = box.bottom + ROOM_PX > window.innerHeight;
      setTip({ text: wrong.title, top: above ? box.top : box.bottom, above });
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);
  return (
    tip && (
      <div className={`glass why-tip${tip.above ? " is-above" : ""}`} aria-hidden="true" style={{ top: tip.top }}>
        {tip.text}
      </div>
    )
  );
}
