/**
 * The Store on PostgreSQL. The only file that knows the schema and talks to the database.
 *
 *   ops.schema_migration    (version PK, applied_at)
 *   app.shop                (shop_id PK, name, code, anchor_fra_node_id + anchor_railroad | lon + lat, changed_at, retired_at)
 *   app.shop_link           (shop_id FK app.shop, link_no) PK, join_fra_node_id
 *   app.route               (route_id PK, name, strategy, turn_at_stops, route_string, saved_no)
 *   app.route_allowed_class (route_id FK app.route, class) PK
 *   app.route_stop          (route_id FK app.route, stop_no) PK, one of shop_id FK app.shop | fra_node_id + next_railroad | lon + lat | typed_text
 *
 * The tables follow app.* in docs/architecture/data/sql/10_now.sql without PostGIS, changesets or versions.
 * A deleted shop is retired, not removed: a saved route may still name it.
 *
 * One SQL text for every database: Neon (or any PostgreSQL) when the target is a postgres:// URL, otherwise
 * PGlite, PostgreSQL compiled to WebAssembly, in a folder ("memory://" for tests).
 */
import { attachDatabasePool } from "@vercel/functions";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../shared/app.ts";
import type { FraId, NodeLocation, PlaceRef, Shop, ShopId } from "../../shared/places.ts";
import type { SavedRoute, SavedRouteId } from "../../shared/plans.ts";
import type { NetworkClass, Railroad, TrackIncluded } from "../../shared/railroads.ts";
import type { RouteStrategy } from "../../shared/route.ts";
import type { Store } from "./store.ts";

type Row = Record<string, unknown>;

interface Sql {
  query(text: string, params?: unknown[]): Promise<Row[]>;
  /** Several statements, no parameters: a migration. */
  exec(text: string): Promise<void>;
}

interface Db extends Sql {
  /** `work` on one connection, committed when it returns, rolled back when it throws. */
  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Connections one server instance holds at most. */
const POOL_SIZE = 5;

/**
 * Applied in order; ops.schema_migration records which ran. A shipped migration never changes: add another to
 * change the schema.
 */
const MIGRATIONS: string[] = [
  `
  CREATE SCHEMA app;

  CREATE TABLE app.shop (
    shop_id            uuid PRIMARY KEY,
    name               text NOT NULL CHECK (name = btrim(name) AND name <> ''),
    code               text CHECK (code = btrim(code) AND code <> ''),
    anchor_fra_node_id integer,
    anchor_railroad    text,
    lon                double precision CHECK (lon BETWEEN -180 AND 180),
    lat                double precision CHECK (lat BETWEEN -90 AND 90),
    changed_at         timestamptz NOT NULL DEFAULT now(),
    retired_at         timestamptz,
    CHECK ((anchor_fra_node_id IS NULL) = (lon IS NOT NULL)),
    CHECK ((lon IS NULL) = (lat IS NULL)),
    CHECK (anchor_railroad IS NULL OR anchor_fra_node_id IS NOT NULL)
  );
  CREATE UNIQUE INDEX shop_code_key ON app.shop (lower(code)) WHERE retired_at IS NULL AND code IS NOT NULL;
  CREATE INDEX shop_name_idx ON app.shop (lower(name)) WHERE retired_at IS NULL;

  CREATE TABLE app.shop_link (
    shop_id          uuid NOT NULL REFERENCES app.shop,
    link_no          smallint NOT NULL CHECK (link_no >= 1),
    join_fra_node_id integer NOT NULL,
    PRIMARY KEY (shop_id, link_no)
  );

  CREATE TABLE app.route (
    route_id      uuid PRIMARY KEY,
    name          text NOT NULL CHECK (name = btrim(name) AND name <> ''),
    strategy      text CHECK (strategy IN ('pick', 'shortest', 'fewest-interchanges', 'no-turn-backs')),
    turn_at_stops boolean NOT NULL,
    route_string  text NOT NULL DEFAULT '',
    saved_no      bigint GENERATED ALWAYS AS IDENTITY UNIQUE
  );
  CREATE INDEX route_name_idx ON app.route (lower(name), saved_no);

  CREATE TABLE app.route_allowed_class (
    route_id uuid NOT NULL REFERENCES app.route ON DELETE CASCADE,
    class    text NOT NULL CHECK (class IN ('regional', 'short_line', 'passenger')),
    PRIMARY KEY (route_id, class)
  );

  CREATE TABLE app.route_stop (
    route_id      uuid NOT NULL REFERENCES app.route ON DELETE CASCADE,
    stop_no       smallint NOT NULL CHECK (stop_no >= 1),
    shop_id       uuid REFERENCES app.shop,
    fra_node_id   integer,
    next_railroad text,
    lon           double precision CHECK (lon BETWEEN -180 AND 180),
    lat           double precision CHECK (lat BETWEEN -90 AND 90),
    typed_text    text,
    PRIMARY KEY (route_id, stop_no),
    CHECK (num_nonnulls(shop_id, fra_node_id, lon, typed_text) = 1),
    CHECK ((lon IS NULL) = (lat IS NULL)),
    CHECK (next_railroad IS NULL OR fra_node_id IS NOT NULL)
  );
  CREATE INDEX route_stop_by_shop ON app.route_stop (shop_id) WHERE shop_id IS NOT NULL;
  `,
];

/** The boxes of TrackIncluded as app.route_allowed_class rows. Class I is always allowed and never stored. */
const CLASS_OF = { regional: "regional", shortLine: "short_line", passenger: "passenger" } as const satisfies Record<keyof TrackIncluded, NetworkClass>;

/** Ids are UUIDs; any other text names nothing. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opens (and creates or migrates) the database: a postgres:// URL, or a PGlite folder ("memory://" for tests). */
export async function openStore(database: string): Promise<Store> {
  const db = /^postgres(ql)?:\/\//.test(database) ? await server(database) : await embedded(database);
  try {
    await migrate(db);
  } catch (error) {
    await db.close();
    throw error;
  }

  const shopsWhere = (condition: string, params: unknown[]) =>
    db.query(
      `SELECT s.*, coalesce(array_agg(l.join_fra_node_id ORDER BY l.link_no) FILTER (WHERE l.shop_id IS NOT NULL), '{}') AS links
       FROM app.shop s LEFT JOIN app.shop_link l USING (shop_id)
       WHERE s.retired_at IS NULL AND ${condition}
       GROUP BY s.shop_id ORDER BY lower(s.name), s.shop_id`,
      params,
    ).then((rows) => rows.map(shopOf));

  const routesWhere = async (condition: string, params: unknown[]): Promise<SavedRoute[]> => {
    const routes = await db.query(
      `SELECT r.*, ARRAY(SELECT c.class FROM app.route_allowed_class c WHERE c.route_id = r.route_id) AS classes
       FROM app.route r WHERE ${condition} ORDER BY lower(r.name), r.saved_no`,
      params,
    );
    const stops = await db.query("SELECT * FROM app.route_stop WHERE route_id = ANY($1::uuid[]) ORDER BY route_id, stop_no", [routes.map((r) => r.route_id)]);
    return routes.map((route) => routeOf(route, stops.filter((stop) => stop.route_id === route.route_id)));
  };

  const removed = (rows: Row[]) => rows.length > 0;

  return {
    shops: {
      all: () => shopsWhere("true", []),
      get: async (id) => (UUID.test(id) ? ((await shopsWhere("s.shop_id = $1", [id]))[0] ?? null) : null),
      named: (text) => shopsWhere("(lower(s.name) = lower($1) OR lower(s.code) = lower($1))", [text.trim()]),
      save: (shop) =>
        db.transaction(async (sql) => {
          if (shop.code !== null) {
            const [other] = await sql.query("SELECT name FROM app.shop WHERE lower(code) = lower($1) AND shop_id <> $2 AND retired_at IS NULL", [shop.code, shop.id]);
            if (other) throw new AppError("conflict", `The shop "${String(other.name)}" already has the code ${shop.code}. Give each shop its own code.`, "code");
          }
          const at = "fraId" in shop.location ? { fraId: shop.location.fraId, railroad: shop.location.railroad, lon: null, lat: null } : { fraId: null, railroad: null, ...shop.location };
          await sql.query(
            `INSERT INTO app.shop (shop_id, name, code, anchor_fra_node_id, anchor_railroad, lon, lat) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (shop_id) DO UPDATE SET name = excluded.name, code = excluded.code, anchor_fra_node_id = excluded.anchor_fra_node_id,
               anchor_railroad = excluded.anchor_railroad, lon = excluded.lon, lat = excluded.lat, changed_at = now()`,
            [shop.id, shop.name, shop.code, at.fraId, at.railroad, at.lon, at.lat],
          );
          await sql.query("DELETE FROM app.shop_link WHERE shop_id = $1", [shop.id]);
          for (const [i, fraId] of shop.links.entries()) {
            await sql.query("INSERT INTO app.shop_link (shop_id, link_no, join_fra_node_id) VALUES ($1, $2, $3)", [shop.id, i + 1, fraId]);
          }
        }),
      remove: async (id) =>
        UUID.test(id) && removed(await db.query("UPDATE app.shop SET retired_at = now() WHERE shop_id = $1 AND retired_at IS NULL RETURNING shop_id", [id])),
    },

    savedRoutes: {
      all: () => routesWhere("true", []),
      get: async (id) => (UUID.test(id) ? ((await routesWhere("r.route_id = $1", [id]))[0] ?? null) : null),
      save: (route) =>
        db
          .transaction(async (sql) => {
            // ON CONFLICT DO UPDATE keeps saved_no, and with it the route's place among same-named routes.
            await sql.query(
              `INSERT INTO app.route (route_id, name, strategy, turn_at_stops, route_string) VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (route_id) DO UPDATE SET name = excluded.name, strategy = excluded.strategy,
                 turn_at_stops = excluded.turn_at_stops, route_string = excluded.route_string`,
              [route.id, route.name, route.option, route.plan.turnAtStops, route.routeString],
            );
            await sql.query("DELETE FROM app.route_allowed_class WHERE route_id = $1", [route.id]);
            await sql.query("DELETE FROM app.route_stop WHERE route_id = $1", [route.id]);
            for (const [box, cls] of Object.entries(CLASS_OF)) {
              if (route.plan.include[box as keyof TrackIncluded]) await sql.query("INSERT INTO app.route_allowed_class (route_id, class) VALUES ($1, $2)", [route.id, cls]);
            }
            for (const [i, place] of route.plan.places.entries()) {
              await sql.query(
                "INSERT INTO app.route_stop (route_id, stop_no, shop_id, fra_node_id, next_railroad, lon, lat, typed_text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                [route.id, i + 1, ...stopColumns(place)],
              );
            }
          })
          .catch((error: unknown) => {
            // 23503: no such shop; 22P02: a shop id of the wrong shape (ids are UUIDs).
            const code = (error as { code?: string }).code;
            if (code === "23503" || code === "22P02") throw new AppError("invalid", "A shop in this route does not exist.", "plan");
            throw error;
          }),
      remove: async (id) => UUID.test(id) && removed(await db.query("DELETE FROM app.route WHERE route_id = $1 RETURNING route_id", [id])),
    },

    close: () => db.close(),
  };
}

/** Runs the migrations not yet applied, all in one transaction. */
async function migrate(db: Db): Promise<void> {
  await db.transaction(async (sql) => {
    // Several servers may start at once (each Vercel instance does): the others wait here, then find nothing to do.
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('visnarn.schema_migration'))");
    await sql.exec(`
      CREATE SCHEMA IF NOT EXISTS ops;
      CREATE TABLE IF NOT EXISTS ops.schema_migration (version integer PRIMARY KEY CHECK (version > 0), applied_at timestamptz NOT NULL DEFAULT now());
    `);
    const [{ version }] = await sql.query("SELECT coalesce(max(version), 0) AS version FROM ops.schema_migration");
    if (Number(version) > MIGRATIONS.length) {
      throw new Error(`The database was written by a newer version of Shop Arrival Check (schema ${version}). Update this copy of the app.`);
    }
    for (const [i, step] of MIGRATIONS.entries()) {
      if (i < Number(version)) continue;
      await sql.exec(step);
      await sql.query("INSERT INTO ops.schema_migration (version) VALUES ($1)", [i + 1]);
    }
  });
}

/** A PostgreSQL server (Neon): a small pool, released while a Vercel function sleeps. */
async function server(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: POOL_SIZE });
  attachDatabasePool(pool);
  const on = (client: Pool | PoolClient): Sql => ({
    query: async (text, params) => (await client.query(text, params)).rows as Row[],
    exec: async (text) => void (await client.query(text)),
  });
  return {
    ...on(pool),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(on(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** PGlite: PostgreSQL in this process, its files in `dir`. */
async function embedded(dir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pglite = await PGlite.create(dir);
  type Client = Pick<typeof pglite, "query" | "exec">;
  const on = (client: Client): Sql => ({
    query: async (text, params) => (await client.query<Row>(text, params)).rows,
    exec: async (text) => void (await client.exec(text)),
  });
  return {
    ...on(pglite),
    transaction: (work) => pglite.transaction((tx) => work(on(tx))),
    close: () => pglite.close(),
  };
}

function shopOf(row: Row): Shop {
  const location: NodeLocation =
    row.anchor_fra_node_id !== null
      ? { fraId: Number(row.anchor_fra_node_id) as FraId, railroad: row.anchor_railroad as Railroad | null }
      : { lon: Number(row.lon), lat: Number(row.lat) };
  return {
    id: String(row.shop_id) as ShopId,
    name: String(row.name),
    code: row.code === null ? null : String(row.code),
    location,
    links: (row.links as number[]).map((fraId) => fraId as FraId),
  };
}

function routeOf(route: Row, stops: Row[]): SavedRoute {
  const classes = route.classes as string[];
  const include = Object.fromEntries(Object.entries(CLASS_OF).map(([box, cls]) => [box, classes.includes(cls)])) as unknown as TrackIncluded;
  return {
    id: String(route.route_id) as SavedRouteId,
    name: String(route.name),
    plan: { places: stops.map(placeOf), include, turnAtStops: Boolean(route.turn_at_stops) },
    option: route.strategy as RouteStrategy | null,
    routeString: String(route.route_string),
  };
}

/** A route_stop row as a place: whichever one of its columns is set. */
function placeOf(row: Row): PlaceRef {
  if (row.shop_id !== null) return { kind: "shop", shopId: String(row.shop_id) as ShopId };
  if (row.fra_node_id !== null) return { kind: "node", fraId: Number(row.fra_node_id) as FraId, railroad: row.next_railroad as Railroad | null };
  if (row.typed_text !== null) return { kind: "text", text: String(row.typed_text) };
  return { kind: "coord", lon: Number(row.lon), lat: Number(row.lat) };
}

/** A place as route_stop columns: shop_id, fra_node_id, next_railroad, lon, lat, typed_text. */
function stopColumns(place: PlaceRef): unknown[] {
  switch (place.kind) {
    case "shop":
      return [place.shopId, null, null, null, null, null];
    case "node":
      return [null, place.fraId, place.railroad, null, null, null];
    case "coord":
      return [null, null, null, place.lon, place.lat, null];
    case "text":
      return [null, null, null, null, null, place.text];
  }
}
