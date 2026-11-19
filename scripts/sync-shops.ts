/**
 * Makes the public site's shops (with their links) the same as this laptop's:
 *   node scripts/sync-shops.ts https://visnarn.vercel.app
 * Reads the shops of the app running on this laptop, then creates, updates and deletes shops on the site until its
 * list matches, a shop matched by its code, else by its name. The site lets a change in only with the owner's token,
 * read from the macOS Keychain (service visnarn-write-token) and never printed.
 */
import { execFileSync } from "node:child_process";
import process from "node:process";
import type { PlaceRef, Shop, ShopDraft, ShopView } from "../shared/places.ts";
import { LOOPBACK, readConfig } from "../server/config.ts";

const site = process.argv[2]?.replace(/\/+$/, "");
if (!site || !URL.canParse(site)) throw new Error("Give the site's address: node scripts/sync-shops.ts https://visnarn.vercel.app");
const laptop = `http://${LOOPBACK}:${readConfig([], process.env).port}`;
const token = execFileSync("security", ["find-generic-password", "-s", "visnarn-write-token", "-w"], { encoding: "utf8" }).trim();

/** One API call; an answer other than 2xx throws with the server's message. */
async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const json: unknown = await response.json();
  const failure = (json as { error?: { message?: string } } | null)?.error?.message;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${url}: ${failure ?? `HTTP ${response.status}`}`);
  return json as T;
}
/** A change on the site: the only calls that carry the token. */
const change = (method: string, path: string, body?: ShopDraft) =>
  call(site + path, { method, headers: { "x-visnarn-write-token": token, "content-type": "application/json" }, body: body && JSON.stringify(body) });

/** A saved shop as the draft that saves it again. */
function draftOf(shop: Shop): ShopDraft {
  const location: PlaceRef = "fraId" in shop.location ? { kind: "node", ...shop.location } : { kind: "coord", ...shop.location };
  return { name: shop.name, code: shop.code, location, links: shop.links };
}
const sameDraft = (a: ShopDraft, b: ShopDraft) => JSON.stringify(a) === JSON.stringify(b);

const wanted = await call<ShopView[]>(`${laptop}/api/shops`);
const online = await call<ShopView[]>(`${site}/api/shops`);
const match = (shop: Shop) => online.find((there) => shop.code && there.code === shop.code) ?? online.find((there) => there.name === shop.name);
const kept = new Set(wanted.map(match));
let changes = 0;

for (const shop of online.filter((there) => !kept.has(there))) {
  await change("DELETE", `/api/shops/${encodeURIComponent(shop.id)}`);
  console.log(`deleted ${shop.name}`);
  changes++;
}
for (const shop of wanted) {
  const there = match(shop);
  const draft = draftOf(shop);
  if (there && sameDraft(draftOf(there), draft)) continue;
  await (there ? change("PUT", `/api/shops/${encodeURIComponent(there.id)}`, draft) : change("POST", "/api/shops", draft));
  console.log(`${there ? "updated" : "created"} ${shop.name}`);
  changes++;
}
console.log(changes ? `${changes} changes; the site now has ${wanted.length} shops.` : `No changes: the site already has the same ${wanted.length} shops.`);
