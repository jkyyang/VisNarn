import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("styles.css", () => {
  // jsdom has no layout, so this reads the rule: a nowrap "DRAFT-UTLX-ECH" made the shop table wider than a 360 px card and clipped Edit.
  it("lets a shop code wrap on a phone so each row's Edit stays visible", () => {
    // The last phone block holds the layout; the first only resizes the tokens.
    const start = css.lastIndexOf("@media (max-width: 640px)");
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    let end = css.indexOf("{", start);
    do {
      if (css[end] === "{") depth++;
      if (css[end] === "}") depth--;
      end++;
    } while (depth > 0 && end < css.length);
    const phone = css.slice(start, end);
    const rule = /\.shop-table td\.shop-code\s*\{([^}]*)\}/.exec(phone);
    expect(rule?.[1]).toMatch(/white-space:\s*normal/);
  });

  // jsdom has no layout: a 190-character unbroken shop name made the Sections list and the shop table thousands of px wide on a phone.
  it("lets a long unbroken shop name or code break anywhere", () => {
    const anywhere = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /overflow-wrap:\s*anywhere/.test(m[2] ?? ""));
    const selectors = anywhere.flatMap((m) => (m[1] ?? "").split(",").map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim()));
    for (const selector of [".section-text", ".shop-name", ".shop-table td.shop-code", ".suggestions li > span:first-child"]) {
      expect(selectors).toContain(selector);
    }
  });

  // jsdom has no layout: the Location input is a block child of .place-field, so without a width it stayed about 196 px and cut the picked place.
  it("makes the shop form's Location input fill the card like Name and Shop code", () => {
    const rule = /\.shop-form \.place-field > input\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/width:\s*100%/);
  });
});
