/**
 * What every drag in the panel shares (a reordered row, the phone's sheet): the rubber band past an end,
 * the speed a finger lets go at, where that momentum carries, and the spring that settles it there.
 */

/** How far momentum carries a release: Apple's deceleration rate, the snappier one. */
const DECELERATION = 0.99;
/** Release speed is measured over the pointer's last moves within this window. */
const VELOCITY_MS = 100;
/** Rubber band stiffness past the ends (Apple's constant). */
const RUBBER = 0.55;
/** The settle spring: response 0.4 s, critically damped, so it lands without bouncing. */
const SPRING = { stiffness: (2 * Math.PI / 0.4) ** 2, damping: (4 * Math.PI * 1) / 0.4 };

export const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Distance past an end, shortened the further it goes. */
export const rubber = (over: number, size: number): number => (over * size * RUBBER) / (size + RUBBER * Math.abs(over));

/** A pointer's last moves, for the speed it is let go at. */
export type Track = { t: number; y: number }[];

export function record(track: Track, y: number): void {
  const now = performance.now();
  track.push({ t: now, y });
  while (track.length > 2 && now - track[0].t > VELOCITY_MS) track.shift();
}

/** The release speed, in px/s. */
export function speed(track: Track): number {
  const first = track[0];
  const last = track[track.length - 1];
  const ms = first && last ? last.t - first.t : 0;
  return ms > 0 ? ((last.y - first.y) / ms) * 1000 : 0;
}

/** Where momentum would carry something let go at `offset` and `velocity` (px/s), as Apple projects a flick. */
export const projected = (offset: number, velocity: number): number => offset + (velocity / 1000) * (DECELERATION / (1 - DECELERATION));

/** Moves `x` to `to` along a damped spring starting at velocity `v` (px/s); returns a stop function. */
export function spring(from: number, to: number, v: number, onUpdate: (x: number) => void, onDone: () => void): () => void {
  let x = from;
  let last = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    v += (-SPRING.stiffness * (x - to) - SPRING.damping * v) * dt;
    x += v * dt;
    if (Math.abs(x - to) < 0.3 && Math.abs(v) < 5) {
      onUpdate(to);
      onDone();
      return;
    }
    onUpdate(x);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
