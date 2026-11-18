import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PIN_ICONS } from "./map/layers.ts";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("styles.css", () => {
  // jsdom has no layout: a 190-character unbroken shop name made the Sections list and the shop table thousands of px wide on a phone,
  // and a nowrap "DRAFT-UTLX-ECH" code pushed each row's Edit out of a 360 px panel.
  it("lets a long unbroken shop name or code break anywhere", () => {
    const anywhere = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /overflow-wrap:\s*anywhere/.test(m[2] ?? ""));
    const selectors = anywhere.flatMap((m) => (m[1] ?? "").split(",").map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim()));
    for (const selector of [".section-text", ".shop-name", ".shop-sub", ".import-preview", ".suggestions li > span:first-child"]) {
      expect(selectors).toContain(selector);
    }
  });

  // The pins are images, which cannot read CSS variables: their colours are written out in web/map/layers.ts.
  it("draws the map's pins in the day look's pin colours", () => {
    const day = (token: string) => new RegExp(`${token}: (#[0-9a-f]{6});`).exec(css)?.[1];
    for (const [pin, token] of [["start", "--pin-a"], ["destination", "--shop"], ["stop", "--route"]] as const) {
      expect(decodeURIComponent(PIN_ICONS[pin].url), `${pin} pin is ${token}`).toContain(day(token));
    }
  });

  // jsdom has no layout: the Location input is a block child of .place-field, so without a width it stayed about 196 px and cut the picked place.
  it("makes the shop form's Location input fill the card like Name and Shop code", () => {
    const rule = /\.shop-form \.place-field > input\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/width:\s*100%/);
  });
});
