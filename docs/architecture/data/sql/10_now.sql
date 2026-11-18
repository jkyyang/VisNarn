-- VisNARN data architecture, stage 1 (NOW).
-- PostgreSQL 12 or newer, PostGIS 3, btree_gist. No JSON column. Tested on PostgreSQL 18.6 + PostGIS 3.6 (PGlite).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- lets one EXCLUDE constraint say "same id AND overlapping releases"

CREATE SCHEMA ops;   -- migrations
CREATE SCHEMA ref;   -- vocabulary other people define: carriers, classes, cities, sources
CREATE SCHEMA net;   -- the public network (NARN), release by release; only the weekly loader writes here
CREATE SCHEMA app;   -- what the team decides: shops, shop links, working routes, own observations

-- ============================================================ ops
CREATE TABLE ops.schema_migration (
  version    integer PRIMARY KEY CHECK (version > 0),
  name       text NOT NULL,
  sha256     text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),   -- a shipped migration file never changes
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ ref
-- Where a fact came from, and on what terms. Every imported or traced row points here.
CREATE TABLE ref.source (
  source_code text PRIMARY KEY CHECK (source_code ~ '^[a-z][a-z0-9_]{1,39}$'),  -- 'narn', 'osm', 'person', 'legacy_sqlite', 'class_policy'
  title       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('public', 'licensed', 'company', 'person', 'policy')),
  licence     text,
  share_alike boolean NOT NULL DEFAULT false,   -- ODbL and similar: counsel decides what may be shared
  restricted  boolean NOT NULL DEFAULT false,   -- entitled company data: never in a personal build
  url         text
);

-- The classes of track a route may use (shared/railroads.ts NETWORK_CLASSES).
CREATE TABLE ref.track_class (
  class    text PRIMARY KEY CHECK (class ~ '^[a-z][a-z_]{1,19}$'),   -- class_i, regional, short_line, passenger
  label    text NOT NULL,
  optional boolean NOT NULL                                         -- false: every route may use it (class_i)
);

-- A railroad by its NARN code (839 codes, all 2 to 4 capitals, measured). Readable text key on purpose.
CREATE TABLE ref.carrier (
  carrier_code   text PRIMARY KEY CHECK (carrier_code ~ '^[A-Z]{2,4}$'),
  name           text,
  class          text NOT NULL REFERENCES ref.track_class,
  class_basis    text NOT NULL CHECK (class_basis IN ('listed', 'default')),   -- default: on no list, so a short line
  class_source   text NOT NULL REFERENCES ref.source,
  class_as_of    date NOT NULL,
  successor_code text REFERENCES ref.carrier,                                  -- KCS -> CPKC
  UNIQUE (carrier_code, class)                                                 -- target of the composite FK below
);

-- The 8 lines graph.bin tells apart, by bit position. The server compares this table with graph_meta.json at start.
CREATE TABLE ref.routing_line (
  line_id      smallint PRIMARY KEY CHECK (line_id BETWEEN 0 AND 7),  -- graph.bin stores the mask in one byte
  label        text NOT NULL UNIQUE,                                   -- 'BNSF' ... 'CPKC', 'regional', 'short line'
  class        text NOT NULL REFERENCES ref.track_class,
  carrier_code text UNIQUE,
  FOREIGN KEY (carrier_code, class) REFERENCES ref.carrier (carrier_code, class),   -- a Class I line must name a Class I carrier
  CHECK ((class = 'class_i') = (carrier_code IS NOT NULL))
);

-- Public city names a person may type as a place (108 today, pipeline/places.py).
CREATE TABLE ref.city (
  city_id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL CHECK (name = btrim(name) AND name <> ''),   -- 'Kansas City, MO'
  geom        geometry(Point, 4326) NOT NULL,
  source_code text NOT NULL REFERENCES ref.source,
  withdrawn   boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX city_name_key ON ref.city (lower(name));

-- ============================================================ net: releases and builds
-- NARN NET: M main, S siding, Y yard. A new value is one more row; the schema stays.
CREATE TABLE net.net_type (
  net_type text PRIMARY KEY CHECK (net_type ~ '^[A-Z]$'),
  label    text NOT NULL,
  is_yard  boolean NOT NULL          -- a car may reverse only between two yard segments
);

-- One NARN download. Node and segment versions count in releases.
CREATE TABLE net.release (
  release_id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_code    text NOT NULL REFERENCES ref.source,
  source_edit_at timestamptz NOT NULL,          -- the layer's editingInfo.dataLastEditDate
  downloaded_at  timestamptz NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),  -- of the canonical rows in FRAARCID order; a new file encoding does not change it
  feature_count  integer NOT NULL CHECK (feature_count > 0),
  status         text NOT NULL CHECK (status IN ('loading', 'loaded', 'failed')),
  loaded_at      timestamptz,
  UNIQUE (source_code, source_edit_at),
  CHECK ((status = 'loaded') = (loaded_at IS NOT NULL))
);

-- One pipeline run over one release: the files the router loads. Routability counts in builds.
-- Why two levels: NARN facts change when FRA edits; routability also changes when our pipeline or class list changes.
CREATE TABLE net.build (
  build_id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id          integer NOT NULL REFERENCES net.release,
  pipeline_version    text NOT NULL,                                               -- git commit of pipeline/
  class_policy_sha256 text NOT NULL CHECK (class_policy_sha256 ~ '^[0-9a-f]{64}$'), -- the class list this build used
  content_sha256      text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),      -- canonical edge list (FRAARCID, ends, km, lines, flags)
  edge_count          integer NOT NULL CHECK (edge_count > 0),
  built_at            timestamptz NOT NULL,
  validated_at        timestamptz,
  live_from           timestamptz,
  live_to             timestamptz,
  rejected_reason     text,
  CHECK (live_from IS NULL OR validated_at IS NOT NULL),
  CHECK (live_to IS NULL OR (live_from IS NOT NULL AND live_to > live_from)),
  CHECK (rejected_reason IS NULL OR live_from IS NULL)
);
CREATE UNIQUE INDEX build_one_live ON net.build ((true)) WHERE live_from IS NOT NULL AND live_to IS NULL;

-- The files of a build, as checksums. The server refuses to start when the files on disk differ.
CREATE TABLE net.build_artifact (
  build_id  integer NOT NULL REFERENCES net.build,
  file_name text NOT NULL,                     -- graph.bin, graph_meta.json, track.bin, basemap_mainline.geojson
  bytes     bigint NOT NULL CHECK (bytes > 0),
  sha256    text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (build_id, file_name)
);

-- ============================================================ net: nodes and segments
-- Identity rows are never deleted, so no foreign key ever dangles. What changes sits in version rows.
-- A version is valid from first_release_id up to (not including) gone_release_id; NULL = still current.
CREATE TABLE net.node (
  fra_node_id      integer PRIMARY KEY CHECK (fra_node_id > 0),   -- FRFRANODE / TOFRANODE. Its number range overlaps FRAARCIDs: never one column for both
  first_release_id integer NOT NULL REFERENCES net.release
);
CREATE TABLE net.node_version (
  fra_node_id      integer NOT NULL REFERENCES net.node,
  first_release_id integer NOT NULL REFERENCES net.release,
  gone_release_id  integer REFERENCES net.release,
  geom             geometry(Point, 4326) NOT NULL,   -- a moved node keeps its identity and gets a new version
  PRIMARY KEY (fra_node_id, first_release_id),
  CHECK (gone_release_id IS NULL OR gone_release_id > first_release_id),
  EXCLUDE USING gist (fra_node_id WITH =, int4range(first_release_id, gone_release_id) WITH &&)
);
CREATE UNIQUE INDEX node_version_now ON net.node_version (fra_node_id) WHERE gone_release_id IS NULL;
CREATE INDEX node_version_geom_now ON net.node_version USING gist (geom) WHERE gone_release_id IS NULL;

-- A subdivision is a name under an owner (2,622 names, 504 under several owners, measured).
CREATE TABLE net.subdivision (
  subdivision_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_code     text REFERENCES ref.carrier,          -- RROWNER1; NULL when its segments list no owner
  name           text NOT NULL CHECK (name = btrim(name) AND name <> ''),
  UNIQUE (owner_code, name)
);
CREATE UNIQUE INDEX subdivision_unowned_key ON net.subdivision (name) WHERE owner_code IS NULL;

-- A segment is a NARN arc. FRAARCID is its key: the public number the FRA, the engine and an analyst all use.
CREATE TABLE net.segment (
  fraarcid         integer PRIMARY KEY CHECK (fraarcid > 0),
  first_release_id integer NOT NULL REFERENCES net.release
);
CREATE TABLE net.segment_version (
  fraarcid         integer NOT NULL REFERENCES net.segment,
  first_release_id integer NOT NULL REFERENCES net.release,
  gone_release_id  integer REFERENCES net.release,
  from_fra_node_id integer NOT NULL REFERENCES net.node,   -- FRFRANODE; equal to the to-node on 4 raw loops
  to_fra_node_id   integer NOT NULL REFERENCES net.node,   -- TOFRANODE
  net_type         text NOT NULL REFERENCES net.net_type,
  tracks           smallint CHECK (tracks >= 0),
  subdivision_id   integer REFERENCES net.subdivision,
  yard_name        text,
  country          text NOT NULL CHECK (country IN ('US', 'CA', 'MX')),
  region           text,                                    -- STATEAB
  length_km        double precision NOT NULL CHECK (length_km > 0),
  geom             geometry(LineString, 4326) NOT NULL,     -- runs from the from-node to the to-node
  attr_sha256      text NOT NULL CHECK (attr_sha256 ~ '^[0-9a-f]{64}$'),   -- every attribute, carrier and vertex: same hash = unchanged
  PRIMARY KEY (fraarcid, first_release_id),
  CHECK (gone_release_id IS NULL OR gone_release_id > first_release_id),
  EXCLUDE USING gist (fraarcid WITH =, int4range(first_release_id, gone_release_id) WITH &&)
);
CREATE UNIQUE INDEX segment_version_now ON net.segment_version (fraarcid) WHERE gone_release_id IS NULL;
CREATE INDEX segment_version_geom_now ON net.segment_version USING gist (geom) WHERE gone_release_id IS NULL;
CREATE INDEX segment_version_from_now ON net.segment_version (from_fra_node_id) WHERE gone_release_id IS NULL;
CREATE INDEX segment_version_to_now ON net.segment_version (to_fra_node_id) WHERE gone_release_id IS NULL;

-- Owners and trackage-rights holders exactly as NARN lists them (replaces 12 columns).
CREATE TABLE net.segment_carrier (
  fraarcid         integer NOT NULL,
  first_release_id integer NOT NULL,
  role             text NOT NULL CHECK (role IN ('owner', 'rights')),
  slot             smallint NOT NULL CHECK (slot BETWEEN 1 AND 9),   -- RROWNER<slot> or TRKRGHTS<slot>
  carrier_code     text NOT NULL REFERENCES ref.carrier,
  PRIMARY KEY (fraarcid, first_release_id, role, slot),
  FOREIGN KEY (fraarcid, first_release_id) REFERENCES net.segment_version,
  CHECK (role = 'rights' OR slot <= 3)
);
CREATE INDEX segment_carrier_by_carrier ON net.segment_carrier (carrier_code);

-- What the pipeline made of a segment. Open-close over builds: an unchanged build writes 0 rows.
CREATE TABLE net.segment_build (
  fraarcid        integer NOT NULL REFERENCES net.segment,
  first_build_id  integer NOT NULL REFERENCES net.build,
  gone_build_id   integer REFERENCES net.build,
  routable        boolean NOT NULL,                     -- it is an edge of graph.bin
  dropped_because text CHECK (dropped_because IN ('no_freight_carrier', 'self_loop', 'parallel', 'mexico_non_class_i',
                                                  'class_i_detached', 'outside_main_component')),
  kept_fraarcid   integer REFERENCES net.segment,       -- parallel: the shorter segment that stands for this one
  PRIMARY KEY (fraarcid, first_build_id),
  CHECK (routable = (dropped_because IS NULL)),
  CHECK ((kept_fraarcid IS NOT NULL) = (dropped_because IS NOT DISTINCT FROM 'parallel')),
  CHECK (kept_fraarcid IS DISTINCT FROM fraarcid),
  CHECK (gone_build_id IS NULL OR gone_build_id > first_build_id),
  EXCLUDE USING gist (fraarcid WITH =, int4range(first_build_id, gone_build_id) WITH &&)
);
CREATE UNIQUE INDEX segment_build_now ON net.segment_build (fraarcid) WHERE gone_build_id IS NULL;

-- Where a vanished id went. No row means it simply went: the closed version already says so.
CREATE TABLE net.segment_lineage (
  old_fraarcid  integer NOT NULL REFERENCES net.segment,
  new_fraarcid  integer NOT NULL REFERENCES net.segment,
  release_id    integer NOT NULL REFERENCES net.release,      -- the release where the change appeared
  kind          text NOT NULL CHECK (kind IN ('renumbered', 'split', 'merged')),
  overlap_share real NOT NULL CHECK (overlap_share > 0 AND overlap_share <= 1),   -- share of the old line lying on the new one
  matched_by    text NOT NULL CHECK (matched_by IN ('geometry', 'person')),
  PRIMARY KEY (old_fraarcid, new_fraarcid, release_id),
  CHECK (old_fraarcid <> new_fraarcid)
);
CREATE INDEX segment_lineage_new ON net.segment_lineage (new_fraarcid);
CREATE TABLE net.node_lineage (
  old_fra_node_id integer NOT NULL REFERENCES net.node,
  new_fra_node_id integer NOT NULL REFERENCES net.node,
  release_id      integer NOT NULL REFERENCES net.release,
  distance_m      real NOT NULL CHECK (distance_m >= 0),
  matched_by      text NOT NULL CHECK (matched_by IN ('position', 'person')),
  PRIMARY KEY (old_fra_node_id, new_fra_node_id, release_id),
  CHECK (old_fra_node_id <> new_fra_node_id)
);

-- Staging for the weekly loader (UNLOGGED: fast, and empty after a crash, which is fine for a re-run).
CREATE UNLOGGED TABLE net.stage_segment (
  fraarcid integer PRIMARY KEY, from_fra_node_id integer NOT NULL, to_fra_node_id integer NOT NULL,
  geom geometry(LineString, 4326) NOT NULL, length_km double precision NOT NULL, net_type text NOT NULL,
  tracks smallint, subdiv text, yard_name text, region text, country text NOT NULL,
  rrowner1 text, rrowner2 text, rrowner3 text,
  trkrghts1 text, trkrghts2 text, trkrghts3 text, trkrghts4 text, trkrghts5 text,
  trkrghts6 text, trkrghts7 text, trkrghts8 text, trkrghts9 text
);
CREATE UNLOGGED TABLE net.stage_build_segment (
  fraarcid integer PRIMARY KEY, routable boolean NOT NULL, dropped_because text, kept_fraarcid integer
);

-- Apply one staged download. Unchanged rows cost nothing; changed rows close and reopen; new ids get lineage.
CREATE PROCEDURE net.apply_release(r integer, lineage_m double precision DEFAULT 3, node_match_m double precision DEFAULT 5)
LANGUAGE plpgsql AS $$
DECLARE
  bad integer;
BEGIN
  PERFORM 1 FROM net.release WHERE release_id = r AND status = 'loading' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'release % is not loading', r; END IF;
  IF EXISTS (SELECT 1 FROM net.release o JOIN net.release n ON n.release_id = r
             WHERE o.status = 'loaded' AND (o.release_id > r OR o.source_edit_at >= n.source_edit_at)) THEN
    RAISE EXCEPTION 'release % is not newer than every loaded release', r;
  END IF;

  -- Carrier codes on no list are short lines, the same rule as pipeline/railroad_classes.py.
  INSERT INTO ref.carrier (carrier_code, class, class_basis, class_source, class_as_of)
  SELECT DISTINCT c, 'short_line', 'default', 'class_policy', current_date
  FROM net.stage_segment s
  CROSS JOIN LATERAL (VALUES (s.rrowner1), (s.rrowner2), (s.rrowner3), (s.trkrghts1), (s.trkrghts2), (s.trkrghts3),
                             (s.trkrghts4), (s.trkrghts5), (s.trkrghts6), (s.trkrghts7), (s.trkrghts8), (s.trkrghts9)) v(c)
  WHERE c IS NOT NULL
  ON CONFLICT (carrier_code) DO NOTHING;

  INSERT INTO net.subdivision (owner_code, name)
  SELECT DISTINCT s.rrowner1, btrim(s.subdiv) FROM net.stage_segment s
  WHERE btrim(coalesce(s.subdiv, '')) <> ''
    AND NOT EXISTS (SELECT 1 FROM net.subdivision d
                    WHERE coalesce(d.owner_code, '') = coalesce(s.rrowner1, '') AND d.name = btrim(s.subdiv));

  -- Nodes come from segment ends. Both ends that name one node must agree (they do to 0 m today).
  CREATE TEMP TABLE staged_end ON COMMIT DROP AS
    SELECT from_fra_node_id AS fra_node_id, ST_StartPoint(geom) AS pt FROM net.stage_segment
    UNION ALL SELECT to_fra_node_id, ST_EndPoint(geom) FROM net.stage_segment;
  CREATE TEMP TABLE staged_node ON COMMIT DROP AS
    SELECT DISTINCT ON (fra_node_id) fra_node_id, pt AS geom FROM staged_end ORDER BY fra_node_id, ST_X(pt), ST_Y(pt);
  CREATE INDEX ON staged_node (fra_node_id);
  SELECT count(*) INTO bad FROM staged_end e JOIN staged_node n USING (fra_node_id)
  WHERE ST_AsBinary(e.pt) <> ST_AsBinary(n.geom) AND ST_Distance(e.pt::geography, n.geom::geography) > node_match_m;
  IF bad > 0 THEN RAISE EXCEPTION '% segment ends lie more than % m from their node', bad, node_match_m; END IF;

  INSERT INTO net.node (fra_node_id, first_release_id) SELECT fra_node_id, r FROM staged_node ON CONFLICT DO NOTHING;
  UPDATE net.node_version v SET gone_release_id = r
  WHERE v.gone_release_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM staged_node s WHERE s.fra_node_id = v.fra_node_id AND ST_Equals(s.geom, v.geom));
  INSERT INTO net.node_version (fra_node_id, first_release_id, geom)
  SELECT s.fra_node_id, r, s.geom FROM staged_node s
  WHERE NOT EXISTS (SELECT 1 FROM net.node_version v WHERE v.fra_node_id = s.fra_node_id AND v.gone_release_id IS NULL);

  -- Segments: a row's text form tells NULL from '' and keeps column order, so the hash is unambiguous.
  CREATE TEMP TABLE staged ON COMMIT DROP AS
  SELECT s.*, encode(sha256(convert_to(ROW(s.from_fra_node_id, s.to_fra_node_id, s.length_km, s.net_type, s.tracks,
           btrim(s.subdiv), s.yard_name, s.region, s.country, s.rrowner1, s.rrowner2, s.rrowner3, s.trkrghts1, s.trkrghts2,
           s.trkrghts3, s.trkrghts4, s.trkrghts5, s.trkrghts6, s.trkrghts7, s.trkrghts8, s.trkrghts9)::text, 'UTF8')
           || ST_AsBinary(s.geom)), 'hex') AS attr_sha256
  FROM net.stage_segment s;
  CREATE INDEX ON staged (fraarcid);

  INSERT INTO net.segment (fraarcid, first_release_id) SELECT fraarcid, r FROM staged ON CONFLICT DO NOTHING;
  UPDATE net.segment_version v SET gone_release_id = r
  WHERE v.gone_release_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM staged s WHERE s.fraarcid = v.fraarcid AND s.attr_sha256 = v.attr_sha256);
  INSERT INTO net.segment_version (fraarcid, first_release_id, from_fra_node_id, to_fra_node_id, net_type, tracks,
                                   subdivision_id, yard_name, country, region, length_km, geom, attr_sha256)
  SELECT s.fraarcid, r, s.from_fra_node_id, s.to_fra_node_id, s.net_type, s.tracks, d.subdivision_id, s.yard_name,
         s.country, s.region, s.length_km, s.geom, s.attr_sha256
  FROM staged s
  LEFT JOIN net.subdivision d ON coalesce(d.owner_code, '') = coalesce(s.rrowner1, '') AND d.name = btrim(s.subdiv)
  WHERE NOT EXISTS (SELECT 1 FROM net.segment_version v WHERE v.fraarcid = s.fraarcid AND v.gone_release_id IS NULL);
  INSERT INTO net.segment_carrier (fraarcid, first_release_id, role, slot, carrier_code)
  SELECT s.fraarcid, r, c.role, c.slot, c.code
  FROM staged s
  JOIN net.segment_version v ON v.fraarcid = s.fraarcid AND v.first_release_id = r
  CROSS JOIN LATERAL (VALUES ('owner', 1, s.rrowner1), ('owner', 2, s.rrowner2), ('owner', 3, s.rrowner3),
      ('rights', 1, s.trkrghts1), ('rights', 2, s.trkrghts2), ('rights', 3, s.trkrghts3), ('rights', 4, s.trkrghts4),
      ('rights', 5, s.trkrghts5), ('rights', 6, s.trkrghts6), ('rights', 7, s.trkrghts7), ('rights', 8, s.trkrghts8),
      ('rights', 9, s.trkrghts9)) AS c(role, slot, code)
  WHERE c.code IS NOT NULL;

  -- Lineage: a vanished FRAARCID and a brand-new one. Same two end nodes settles it. Otherwise one line must lie
  -- almost wholly on the other within lineage_m. Yard tracks run about 4.5 m apart, so the default is tight on purpose:
  -- a looser match pairs neighbouring yard tracks. Lineage is a suggestion; a person applies it.
  INSERT INTO net.segment_lineage (old_fraarcid, new_fraarcid, release_id, kind, overlap_share, matched_by)
  SELECT m.old_id, m.new_id, r,
         CASE WHEN m.same_ends OR (count(*) OVER (PARTITION BY m.old_id) = 1 AND count(*) OVER (PARTITION BY m.new_id) = 1) THEN 'renumbered'
              WHEN count(*) OVER (PARTITION BY m.old_id) > 1 THEN 'split' ELSE 'merged' END,
         m.share_old, 'geometry'
  FROM (
    SELECT g.fraarcid AS old_id, n.fraarcid AS new_id,
           (least(g.from_fra_node_id, g.to_fra_node_id), greatest(g.from_fra_node_id, g.to_fra_node_id))
             = (least(n.from_fra_node_id, n.to_fra_node_id), greatest(n.from_fra_node_id, n.to_fra_node_id)) AS same_ends,
           least(1, ST_Length(ST_Intersection(g.geom, ST_Buffer(n.geom::geography, lineage_m)::geometry)::geography)
                    / ST_Length(g.geom::geography))::real AS share_old,
           least(1, ST_Length(ST_Intersection(n.geom, ST_Buffer(g.geom::geography, lineage_m)::geometry)::geography)
                    / ST_Length(n.geom::geography))::real AS share_new
    FROM net.segment_version g
    JOIN net.segment_version n ON n.first_release_id = r AND n.gone_release_id IS NULL
     AND ST_DWithin(n.geom::geography, g.geom::geography, lineage_m)
     AND EXISTS (SELECT 1 FROM net.segment i WHERE i.fraarcid = n.fraarcid AND i.first_release_id = r)
    WHERE g.gone_release_id = r
      AND NOT EXISTS (SELECT 1 FROM net.segment_version x WHERE x.fraarcid = g.fraarcid AND x.first_release_id = r)
  ) m
  WHERE m.share_old > 0 AND (m.same_ends OR greatest(m.share_old, m.share_new) >= 0.9);

  INSERT INTO net.node_lineage (old_fra_node_id, new_fra_node_id, release_id, distance_m, matched_by)
  SELECT g.fra_node_id, n.fra_node_id, r, ST_Distance(g.geom::geography, n.geom::geography)::real, 'position'
  FROM net.node_version g
  JOIN LATERAL (
    SELECT v.fra_node_id, v.geom FROM net.node_version v
    JOIN net.node i ON i.fra_node_id = v.fra_node_id AND i.first_release_id = r
    WHERE v.gone_release_id IS NULL AND ST_DWithin(v.geom::geography, g.geom::geography, node_match_m)
    ORDER BY v.geom <-> g.geom LIMIT 1) n ON true
  WHERE g.gone_release_id = r
    AND NOT EXISTS (SELECT 1 FROM net.node_version x WHERE x.fra_node_id = g.fra_node_id AND x.first_release_id = r);

  UPDATE net.release SET status = 'loaded', loaded_at = now() WHERE release_id = r;
END $$;

-- Apply what one build made of each segment (staged by the pipeline), and mark the build validated.
CREATE PROCEDURE net.apply_build(b integer)
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM net.build WHERE build_id = b AND validated_at IS NULL AND rejected_reason IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'build % is not waiting to be applied', b; END IF;
  IF EXISTS (SELECT 1 FROM net.build WHERE build_id > b AND validated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'build % is older than a build already applied', b;
  END IF;
  UPDATE net.segment_build v SET gone_build_id = b
  WHERE v.gone_build_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM net.stage_build_segment s
    WHERE s.fraarcid = v.fraarcid AND s.routable = v.routable
      AND s.dropped_because IS NOT DISTINCT FROM v.dropped_because AND s.kept_fraarcid IS NOT DISTINCT FROM v.kept_fraarcid);
  INSERT INTO net.segment_build (fraarcid, first_build_id, routable, dropped_because, kept_fraarcid)
  SELECT s.fraarcid, b, s.routable, s.dropped_because, s.kept_fraarcid FROM net.stage_build_segment s
  WHERE NOT EXISTS (SELECT 1 FROM net.segment_build v WHERE v.fraarcid = s.fraarcid AND v.gone_build_id IS NULL);
  UPDATE net.build SET validated_at = now() WHERE build_id = b;
END $$;

-- Switch the live build. Called in the same transaction as apply_release, apply_build and the link detach.
CREATE PROCEDURE net.go_live(b integer)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE net.build SET live_to = now() WHERE live_from IS NOT NULL AND live_to IS NULL AND build_id <> b;
  UPDATE net.build SET live_from = now() WHERE build_id = b AND validated_at IS NOT NULL AND live_from IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'build % is not validated, or was live before', b; END IF;
  PERFORM pg_notify('visnarn_build', b::text);
END $$;

CREATE VIEW net.build_live AS SELECT * FROM net.build WHERE live_from IS NOT NULL AND live_to IS NULL;
CREATE VIEW net.segment_now AS
SELECT v.fraarcid, v.from_fra_node_id, v.to_fra_node_id, v.net_type, t.is_yard, v.tracks, v.subdivision_id,
       v.yard_name, v.country, v.region, v.length_km, v.geom, b.routable, b.dropped_because, b.kept_fraarcid
FROM net.segment_version v
JOIN net.net_type t USING (net_type)
LEFT JOIN net.segment_build b ON b.fraarcid = v.fraarcid AND b.gone_build_id IS NULL
WHERE v.gone_release_id IS NULL;

-- ============================================================ app: people, changesets, rules
CREATE TABLE app.person (
  person_id    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login        text NOT NULL UNIQUE CHECK (login = lower(login) AND login <> ''),
  display_name text NOT NULL CHECK (display_name <> ''),
  active       boolean NOT NULL DEFAULT true
);

-- One write transaction by one person. Its id is the store's revision.
CREATE SEQUENCE app.changeset_seq;
CREATE TABLE app.changeset (
  changeset_id bigint PRIMARY KEY,                      -- set by the trigger below, after the writer lock
  person_id    integer NOT NULL REFERENCES app.person,
  made_at      timestamptz NOT NULL DEFAULT now(),
  origin       text NOT NULL CHECK (origin IN ('ui', 'import', 'migration')),
  note         text
);
CREATE FUNCTION app.changeset_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- One writer at a time. The id is taken after the lock, so ids rise in commit order and
  -- "everything up to changeset N" is a state that really existed. Writes are rare; the wait costs nothing.
  PERFORM pg_advisory_xact_lock(hashtext('visnarn.changeset'));
  NEW.changeset_id := nextval('app.changeset_seq');
  NEW.made_at := clock_timestamp();
  PERFORM pg_notify('visnarn_change', NEW.changeset_id::text);   -- delivered at commit; replaces the in-process counter
  RETURN NEW;
END $$;
CREATE TRIGGER changeset_stamp BEFORE INSERT ON app.changeset FOR EACH ROW EXECUTE FUNCTION app.changeset_stamp();

-- The routing policy a result was computed with (engine/rules.ts). The server registers its own at start.
CREATE TABLE app.ruleset (
  ruleset_id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint    text NOT NULL UNIQUE CHECK (fingerprint ~ '^[0-9a-f]{64}$'),   -- over engine_version and every (name, value)
  engine_version text NOT NULL,                                                 -- a code-only change also gets a new ruleset
  first_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.ruleset_value (
  ruleset_id integer NOT NULL REFERENCES app.ruleset,
  name       text NOT NULL CHECK (name ~ '^[A-Z][A-Z0-9_]*$'),   -- 'INTERCHANGE_PENALTY_KM', 'REVERSE_KM'
  value      double precision NOT NULL,
  PRIMARY KEY (ruleset_id, name)
);

-- Labels may be edited in place. rev_no catches two people editing at once:
-- UPDATE ... SET ..., rev_no = rev_no + 1, changed_changeset_id = $new WHERE id = $1 AND rev_no = $seen
CREATE FUNCTION app.label_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rev_no <> OLD.rev_no + 1 OR NEW.changed_changeset_id <= OLD.changed_changeset_id
     OR NEW.created_changeset_id <> OLD.created_changeset_id THEN
    RAISE EXCEPTION 'an edit must raise rev_no by 1 and name a newer changeset' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ============================================================ app: shops and shop links
CREATE TABLE app.shop (
  shop_id              uuid PRIMARY KEY,                    -- kept from SQLite
  name                 text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 200),
  code                 text CHECK (code = btrim(code) AND char_length(code) BETWEEN 1 AND 200),   -- the team's code, 'NLR-01'
  geom                 geometry(Point, 4326) NOT NULL,      -- where the shop is drawn
  anchor_fra_node_id   integer REFERENCES net.node,         -- today's node pick; NULL: the shop snaps from geom as today
  anchor_line_id       smallint REFERENCES ref.routing_line,-- the "Which line?" answer at that node
  company_mark         text CHECK (company_mark ~ '^[A-Z]{2,4}$'),   -- the shop couplet: mark + SPLC. Blank until known
  splc                 text CHECK (splc ~ '^[0-9]{9}$'),
  serving_carrier_code text REFERENCES ref.carrier,
  rev_no               integer NOT NULL DEFAULT 1 CHECK (rev_no >= 1),
  created_changeset_id bigint NOT NULL REFERENCES app.changeset,
  changed_changeset_id bigint NOT NULL REFERENCES app.changeset,
  retired_changeset_id bigint REFERENCES app.changeset,     -- a shop that a route or link uses cannot be deleted; retire it
  CHECK (anchor_line_id IS NULL OR anchor_fra_node_id IS NOT NULL),
  CHECK (changed_changeset_id >= created_changeset_id)
);
CREATE UNIQUE INDEX shop_code_key ON app.shop (lower(code)) WHERE retired_changeset_id IS NULL AND code IS NOT NULL;
CREATE INDEX shop_name_idx ON app.shop (lower(name), created_changeset_id) WHERE retired_changeset_id IS NULL;
CREATE INDEX shop_geom_idx ON app.shop USING gist (geom);
CREATE TRIGGER shop_label_guard BEFORE UPDATE ON app.shop FOR EACH ROW EXECUTE FUNCTION app.label_guard();

-- One terminal of a shop: private track from one point of the public network to the shop.
-- Confirmed open links: 0 = the shop sits at its anchor or snaps, 1 = stub end, 2 = through track, 3+ = wye, loop or two railroads.
-- The count is never stored. A link is never redrawn: a correction closes the row and opens another with the same link_no,
-- so a saved route keeps the exact link it used.
CREATE TABLE app.shop_link (
  shop_link_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id                uuid NOT NULL REFERENCES app.shop,
  link_no                smallint NOT NULL CHECK (link_no >= 1),
  supersedes_link_id     bigint REFERENCES app.shop_link,
  join_fra_node_id       integer REFERENCES net.node,                -- the join is a node ...
  join_fraarcid          integer REFERENCES net.segment,             -- ... or a point part-way along a segment
  join_fraction          double precision CHECK (join_fraction > 0 AND join_fraction < 1),   -- share of its length from the from-node
  join_geom              geometry(Point, 4326) NOT NULL,             -- the join as drawn: each release tests it, and can find it again
  geom                   geometry(LineString, 4326) NOT NULL,        -- the private track, from the join to the shop
  length_km              double precision GENERATED ALWAYS AS (ST_Length(geom::geography) / 1000) STORED,
  carrier_code           text REFERENCES ref.carrier,                -- who switches the shop over it; NULL: any railroad at the join
  source_code            text NOT NULL REFERENCES ref.source,        -- person (drawn), osm (traced), narn (a dead end picked)
  source_ref             text,                                       -- e.g. the OpenStreetMap way id
  source_as_of           date,
  created_changeset_id   bigint NOT NULL REFERENCES app.changeset,
  confirmed_changeset_id bigint REFERENCES app.changeset,             -- NULL: a suggestion; the router ignores it
  checked_build_id       integer NOT NULL REFERENCES net.build,      -- the last build on which the join was found
  detached_build_id      integer REFERENCES net.build,               -- the build that lost the join; ignored until replaced
  closed_changeset_id    bigint REFERENCES app.changeset,
  CHECK (num_nonnulls(join_fra_node_id, join_fraarcid) = 1),
  CHECK ((join_fraarcid IS NULL) = (join_fraction IS NULL)),
  CHECK (ST_Equals(ST_StartPoint(geom), join_geom)),
  CHECK (ST_Length(geom::geography) > 0),
  CHECK (source_code <> 'osm' OR source_ref IS NOT NULL),
  CHECK (confirmed_changeset_id IS NULL OR confirmed_changeset_id >= created_changeset_id),
  CHECK (closed_changeset_id IS NULL OR closed_changeset_id >= created_changeset_id)
);
CREATE UNIQUE INDEX shop_link_open ON app.shop_link (shop_id, link_no) WHERE closed_changeset_id IS NULL;
CREATE INDEX shop_link_by_node ON app.shop_link (join_fra_node_id) WHERE closed_changeset_id IS NULL AND join_fra_node_id IS NOT NULL;
CREATE INDEX shop_link_by_segment ON app.shop_link (join_fraarcid) WHERE closed_changeset_id IS NULL AND join_fraarcid IS NOT NULL;
CREATE INDEX shop_link_geom ON app.shop_link USING gist (geom);

CREATE FUNCTION app.shop_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'shop link % cannot be deleted: close it', OLD.shop_link_id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.closed_changeset_id IS NOT NULL
     OR (NEW.shop_id, NEW.link_no, NEW.supersedes_link_id, NEW.join_fra_node_id, NEW.join_fraarcid, NEW.join_fraction,
         ST_AsEWKB(NEW.join_geom), ST_AsEWKB(NEW.geom), NEW.carrier_code, NEW.source_code, NEW.source_ref, NEW.source_as_of,
         NEW.created_changeset_id)
        IS DISTINCT FROM
        (OLD.shop_id, OLD.link_no, OLD.supersedes_link_id, OLD.join_fra_node_id, OLD.join_fraarcid, OLD.join_fraction,
         ST_AsEWKB(OLD.join_geom), ST_AsEWKB(OLD.geom), OLD.carrier_code, OLD.source_code, OLD.source_ref, OLD.source_as_of,
         OLD.created_changeset_id)
     OR (OLD.confirmed_changeset_id IS NOT NULL AND NEW.confirmed_changeset_id IS DISTINCT FROM OLD.confirmed_changeset_id)
     OR (OLD.detached_build_id IS NOT NULL AND NEW.detached_build_id IS DISTINCT FROM OLD.detached_build_id)
     OR NEW.checked_build_id < OLD.checked_build_id THEN
    RAISE EXCEPTION 'shop link % is drawn once: its stamps only move forward; insert a new link to change it', OLD.shop_link_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shop_link_guard BEFORE UPDATE OR DELETE ON app.shop_link FOR EACH ROW EXECUTE FUNCTION app.shop_link_guard();

CREATE VIEW app.shop_link_now AS
SELECT l.*,
       CASE WHEN l.detached_build_id IS NOT NULL THEN 'detached'
            WHEN l.confirmed_changeset_id IS NULL THEN 'proposed'
            ELSE 'confirmed' END AS status
FROM app.shop_link l
WHERE l.closed_changeset_id IS NULL;

CREATE VIEW app.shop_now AS
SELECT s.*, coalesce(k.links, 0) AS links,
       CASE coalesce(k.links, 0)
         WHEN 0 THEN CASE WHEN s.anchor_fra_node_id IS NULL THEN 'snapped' ELSE 'at_node' END
         WHEN 1 THEN 'stub' WHEN 2 THEN 'through' ELSE 'multi' END AS shape
FROM app.shop s
LEFT JOIN (SELECT shop_id, count(*) AS links FROM app.shop_link_now WHERE status = 'confirmed' GROUP BY shop_id) k USING (shop_id)
WHERE s.retired_changeset_id IS NULL;

-- The overlay revision: it changes whenever anything the router merges from app changes. Part of every route cache key.
CREATE VIEW app.overlay_revision AS
SELECT greatest(0,
  (SELECT max(changed_changeset_id) FROM app.shop),
  (SELECT max(greatest(created_changeset_id, confirmed_changeset_id, closed_changeset_id)) FROM app.shop_link)
)::bigint AS overlay_changeset_id;

-- ============================================================ app: working routes
CREATE TABLE app.route (
  route_id             uuid PRIMARY KEY,                    -- kept from SQLite
  name                 text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  rev_no               integer NOT NULL DEFAULT 1 CHECK (rev_no >= 1),
  created_changeset_id bigint NOT NULL REFERENCES app.changeset,
  changed_changeset_id bigint NOT NULL REFERENCES app.changeset,
  retired_changeset_id bigint REFERENCES app.changeset,
  CHECK (changed_changeset_id >= created_changeset_id)
);
CREATE INDEX route_name_idx ON app.route (lower(name), created_changeset_id) WHERE retired_changeset_id IS NULL;
CREATE TRIGGER route_label_guard BEFORE UPDATE ON app.route FOR EACH ROW EXECUTE FUNCTION app.label_guard();

-- One saved state of a route: the question (stops, classes, strategy) and the answer (legs, path).
-- Written whole in one transaction, then sealed; a sealed version never changes. A change is the next version.
CREATE TABLE app.route_version (
  route_id             uuid NOT NULL REFERENCES app.route,  -- no cascade: a route with versions is retired and kept
  version_no           integer NOT NULL CHECK (version_no >= 1),
  basis                text NOT NULL CHECK (basis IN ('computed', 'imported')),   -- imported: waypoints from SQLite, no answer yet
  strategy             text CHECK (strategy IN ('pick', 'shortest', 'fewest-interchanges', 'no-turn-backs')),
  build_id             integer REFERENCES net.build,       -- the network the answer was computed on
  ruleset_id           integer REFERENCES app.ruleset,     -- the routing rules it was computed with
  overlay_changeset_id bigint CHECK (overlay_changeset_id >= 0),   -- the shop links it was computed with
  length_km            double precision CHECK (length_km > 0),
  route_string         text NOT NULL DEFAULT '',           -- 'BNSF-[Kansas City, MO]-UP', built by the server from the legs
  note                 text,
  opened_changeset_id  bigint NOT NULL REFERENCES app.changeset,   -- who saved it, and when (for 'computed': who confirmed it)
  sealed               boolean NOT NULL DEFAULT false,
  closed_changeset_id  bigint REFERENCES app.changeset,           -- the next version, or the route's retirement
  PRIMARY KEY (route_id, version_no),
  CHECK ((basis = 'computed') = (build_id IS NOT NULL)),
  CHECK ((basis = 'computed') = (ruleset_id IS NOT NULL)),
  CHECK ((basis = 'computed') = (overlay_changeset_id IS NOT NULL)),
  CHECK ((basis = 'computed') = (length_km IS NOT NULL)),
  CHECK (closed_changeset_id IS NULL OR closed_changeset_id >= opened_changeset_id)
);
CREATE UNIQUE INDEX route_version_open ON app.route_version (route_id) WHERE closed_changeset_id IS NULL;
CREATE INDEX route_version_by_build ON app.route_version (build_id) WHERE closed_changeset_id IS NULL;

-- The optional classes of track this version may use (regional, short_line, passenger). Class I is always allowed.
CREATE TABLE app.route_allowed_class (
  route_id   uuid NOT NULL,
  version_no integer NOT NULL,
  class      text NOT NULL REFERENCES ref.track_class,
  PRIMARY KEY (route_id, version_no, class),
  FOREIGN KEY (route_id, version_no) REFERENCES app.route_version
);

-- The places in travel order: 1 is the start, the highest the destination, the rest stops.
CREATE TABLE app.route_stop (
  route_id            uuid NOT NULL,
  version_no          integer NOT NULL,
  stop_no             smallint NOT NULL CHECK (stop_no >= 1),
  shop_id             uuid REFERENCES app.shop,            -- the place as the person gave it: exactly one of these five
  fra_node_id         integer REFERENCES net.node,
  city_id             integer REFERENCES ref.city,
  point               geometry(Point, 4326),
  unresolved_text     text,                                -- imported versions only: text that matched nothing
  next_line_id        smallint REFERENCES ref.routing_line,-- "Which line?" answered here; NULL: the router's pick
  may_turn            boolean NOT NULL DEFAULT false,      -- the route may leave this place in either direction
  reached_fra_node_id integer REFERENCES net.node,         -- where the saved track meets the place (computed versions)
  reached_km          double precision CHECK (reached_km >= 0),
  snap_km             double precision CHECK (snap_km >= 0),   -- how far a city or a point was moved onto track
  PRIMARY KEY (route_id, version_no, stop_no),
  FOREIGN KEY (route_id, version_no) REFERENCES app.route_version,
  CHECK (num_nonnulls(shop_id, fra_node_id, city_id, point, unresolved_text) = 1),
  CHECK (snap_km IS NULL OR city_id IS NOT NULL OR point IS NOT NULL)
);
CREATE INDEX route_stop_by_shop ON app.route_stop (shop_id) WHERE shop_id IS NOT NULL;
CREATE INDEX route_stop_by_node ON app.route_stop (fra_node_id) WHERE fra_node_id IS NOT NULL;

-- The route as the industry writes it: one row per carrier, in order, with the place it takes the car over.
CREATE TABLE app.route_leg (
  route_id            uuid NOT NULL,
  version_no          integer NOT NULL,
  leg_no              smallint NOT NULL CHECK (leg_no >= 1),
  line_id             smallint NOT NULL REFERENCES ref.routing_line,   -- what the router ran it on
  carrier_code        text REFERENCES ref.carrier,          -- the exact railroad when the track names one (fills in short lines)
  handoff_fra_node_id integer REFERENCES net.node,          -- where this leg takes the car over; NULL on leg 1
  handoff_place       text,                                 -- our name for it when saved: 'Kansas City, MO'
  handoff_by          text CHECK (handoff_by IN ('person', 'router')),   -- who chose this change of railroad
  length_km           double precision NOT NULL CHECK (length_km > 0),
  PRIMARY KEY (route_id, version_no, leg_no),
  FOREIGN KEY (route_id, version_no) REFERENCES app.route_version,
  CHECK ((leg_no = 1) = (handoff_fra_node_id IS NULL)),
  CHECK ((leg_no = 1) = (handoff_by IS NULL))
);

-- The exact track, piece by piece: the snapshot every later build is compared with.
CREATE TABLE app.route_path (
  route_id      uuid NOT NULL,
  version_no    integer NOT NULL,
  seq           integer NOT NULL CHECK (seq >= 1),
  leg_no        smallint NOT NULL,
  fraarcid      integer REFERENCES net.segment,         -- a public segment ...
  shop_link_id  bigint REFERENCES app.shop_link,        -- ... or a shop's private track
  forward       boolean NOT NULL,                       -- true: from the from-node (or the join) toward the to-node (or the shop)
  from_fraction double precision NOT NULL DEFAULT 0,    -- the part travelled, as shares of the piece's length
  to_fraction   double precision NOT NULL DEFAULT 1,
  length_km     double precision NOT NULL CHECK (length_km > 0),
  turn_back     text CHECK (turn_back IN ('yard', 'stub-end', 'stop')),   -- this piece leaves a reversal
  turn_deg      smallint CHECK (turn_deg BETWEEN 0 AND 180),
  PRIMARY KEY (route_id, version_no, seq),
  FOREIGN KEY (route_id, version_no, leg_no) REFERENCES app.route_leg,
  CHECK (num_nonnulls(fraarcid, shop_link_id) = 1),
  CHECK (0 <= from_fraction AND from_fraction < to_fraction AND to_fraction <= 1),
  CHECK ((turn_back IS NULL) = (turn_deg IS NULL))
);
CREATE INDEX route_path_by_segment ON app.route_path (fraarcid) WHERE fraarcid IS NOT NULL;
CREATE INDEX route_path_by_link ON app.route_path (shop_link_id) WHERE shop_link_id IS NOT NULL;

-- Each time a sealed version was computed again and compared with its snapshot. Derived: may be deleted and rebuilt.
CREATE TABLE app.route_check (
  route_id             uuid NOT NULL,
  version_no           integer NOT NULL,
  build_id             integer NOT NULL REFERENCES net.build,
  ruleset_id           integer NOT NULL REFERENCES app.ruleset,
  overlay_changeset_id bigint NOT NULL CHECK (overlay_changeset_id >= 0),
  cause                text NOT NULL CHECK (cause IN ('build', 'ruleset', 'overlay', 'open')),
  checked_at           timestamptz NOT NULL DEFAULT now(),
  result               text NOT NULL CHECK (result IN ('same', 'track_changed', 'carriers_changed', 'broken')),
  length_km            double precision CHECK (length_km > 0),    -- of the route found now
  first_difference_seq integer CHECK (first_difference_seq >= 1), -- where the new track first leaves the saved one
  problem              text,                                      -- one line when broken: 'FRA node 386145 is gone'
  seen_changeset_id    bigint REFERENCES app.changeset,           -- a person saw the difference and kept the saved version
  PRIMARY KEY (route_id, version_no, build_id, ruleset_id, overlay_changeset_id),
  FOREIGN KEY (route_id, version_no) REFERENCES app.route_version,
  CHECK ((result = 'broken') = (problem IS NOT NULL)),
  CHECK ((result = 'broken') = (length_km IS NULL)),
  CHECK ((result IN ('same', 'broken')) = (first_difference_seq IS NULL))
);
CREATE INDEX route_check_latest ON app.route_check (route_id, version_no, checked_at DESC);

-- Sealing runs the cross-row checks once. After that only closing is allowed.
CREATE FUNCTION app.route_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n int; top int; legs_km double precision; path_km double precision; tol double precision;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sealed THEN RAISE EXCEPTION 'insert a version unsealed, add its rows, then seal it'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.sealed THEN
      RAISE EXCEPTION 'route version %/% is saved: it cannot be deleted', OLD.route_id, OLD.version_no USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.sealed THEN
    IF OLD.closed_changeset_id IS NULL AND NEW.closed_changeset_id IS NOT NULL
       AND (to_jsonb(NEW) - 'closed_changeset_id') = (to_jsonb(OLD) - 'closed_changeset_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'route version %/% is saved: save a new version instead', OLD.route_id, OLD.version_no
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT NEW.sealed THEN RETURN NEW; END IF;

  SELECT count(*), coalesce(max(stop_no), 0) INTO n, top FROM app.route_stop
  WHERE route_id = NEW.route_id AND version_no = NEW.version_no;
  IF n < 2 OR top <> n THEN RAISE EXCEPTION 'a route needs places numbered 1..n with n >= 2 (has %)', n; END IF;
  IF NEW.basis = 'imported' THEN
    IF EXISTS (SELECT 1 FROM app.route_leg WHERE route_id = NEW.route_id AND version_no = NEW.version_no) THEN
      RAISE EXCEPTION 'an imported version has no answer yet: no legs or path';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM app.route_stop WHERE route_id = NEW.route_id AND version_no = NEW.version_no AND unresolved_text IS NOT NULL) THEN
    RAISE EXCEPTION 'a computed version cannot hold unresolved text';
  END IF;
  SELECT count(*), coalesce(max(leg_no), 0), coalesce(sum(length_km), 0) INTO n, top, legs_km FROM app.route_leg
  WHERE route_id = NEW.route_id AND version_no = NEW.version_no;
  IF n = 0 OR top <> n THEN RAISE EXCEPTION 'legs must be numbered 1..n (has %)', n; END IF;
  SELECT count(*), coalesce(max(seq), 0), coalesce(sum(length_km), 0) INTO n, top, path_km FROM app.route_path
  WHERE route_id = NEW.route_id AND version_no = NEW.version_no;
  IF n = 0 OR top <> n THEN RAISE EXCEPTION 'path pieces must be numbered 1..n (has %)', n; END IF;
  IF EXISTS (SELECT 1 FROM app.route_leg l WHERE l.route_id = NEW.route_id AND l.version_no = NEW.version_no
             AND NOT EXISTS (SELECT 1 FROM app.route_path p WHERE p.route_id = l.route_id AND p.version_no = l.version_no AND p.leg_no = l.leg_no)) THEN
    RAISE EXCEPTION 'every leg needs its track';
  END IF;
  tol := greatest(0.01, NEW.length_km * 0.001);
  IF abs(legs_km - NEW.length_km) > tol OR abs(path_km - NEW.length_km) > tol THEN
    RAISE EXCEPTION 'route km % disagrees with legs % or path %', NEW.length_km, legs_km, path_km;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER route_version_guard BEFORE INSERT OR UPDATE OR DELETE ON app.route_version
  FOR EACH ROW EXECUTE FUNCTION app.route_version_guard();

-- A version must be sealed by the end of the transaction that wrote it.
CREATE FUNCTION app.route_version_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.route_version WHERE route_id = NEW.route_id AND version_no = NEW.version_no AND NOT sealed) THEN
    RAISE EXCEPTION 'route version %/% was written but not sealed', NEW.route_id, NEW.version_no;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER route_version_sealed AFTER INSERT ON app.route_version
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.route_version_sealed();

-- The rows of a sealed version cannot be added, changed or removed.
CREATE FUNCTION app.route_part_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
       SELECT 1 FROM app.route_version WHERE route_id = OLD.route_id AND version_no = OLD.version_no AND sealed) THEN
    RAISE EXCEPTION 'route version %/% is saved: its % rows cannot change', OLD.route_id, OLD.version_no, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
       SELECT 1 FROM app.route_version WHERE route_id = NEW.route_id AND version_no = NEW.version_no AND sealed) THEN
    RAISE EXCEPTION 'route version %/% is saved: its % rows cannot change', NEW.route_id, NEW.version_no, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER route_allowed_class_guard BEFORE INSERT OR UPDATE OR DELETE ON app.route_allowed_class FOR EACH ROW EXECUTE FUNCTION app.route_part_guard();
CREATE TRIGGER route_stop_guard BEFORE INSERT OR UPDATE OR DELETE ON app.route_stop FOR EACH ROW EXECUTE FUNCTION app.route_part_guard();
CREATE TRIGGER route_leg_guard  BEFORE INSERT OR UPDATE OR DELETE ON app.route_leg  FOR EACH ROW EXECUTE FUNCTION app.route_part_guard();
CREATE TRIGGER route_path_guard BEFORE INSERT OR UPDATE OR DELETE ON app.route_path FOR EACH ROW EXECUTE FUNCTION app.route_part_guard();

CREATE VIEW app.route_now AS
SELECT r.route_id, r.name, r.created_changeset_id, v.version_no, v.basis, v.strategy, v.build_id, v.length_km, v.route_string,
       c.made_at AS saved_at, c.person_id AS saved_by,
       k.result AS last_check, k.build_id AS checked_on_build, k.length_km AS checked_km, k.problem,
       k.seen_changeset_id IS NOT NULL AS difference_seen
FROM app.route r
JOIN app.route_version v ON v.route_id = r.route_id AND v.closed_changeset_id IS NULL
JOIN app.changeset c ON c.changeset_id = v.opened_changeset_id
LEFT JOIN LATERAL (SELECT * FROM app.route_check k WHERE k.route_id = v.route_id AND k.version_no = v.version_no
                   ORDER BY k.checked_at DESC LIMIT 1) k ON true
WHERE r.retired_changeset_id IS NULL;

-- "Hot shops" today: how many open working routes use each shop. No new table needed.
CREATE VIEW app.shop_use AS
SELECT st.shop_id, count(DISTINCT st.route_id) AS open_routes
FROM app.route_stop st
JOIN app.route_version v USING (route_id, version_no)
JOIN app.route r USING (route_id)
WHERE v.closed_changeset_id IS NULL AND r.retired_changeset_id IS NULL AND st.shop_id IS NOT NULL
GROUP BY st.shop_id;

-- ============================================================ app: own observations (optional in stage 1)
-- A trip: one car seen moving along one saved working route. The car number is optional on purpose.
CREATE TABLE app.trip (
  trip_id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_id               uuid NOT NULL,
  version_no             integer NOT NULL,
  car_ref                text CHECK (car_ref ~ '^[A-Z]{2,4} [0-9]{1,6}$'),   -- 'UTLX 123456'; leave NULL until the company agrees
  load_status            text CHECK (load_status IN ('L', 'E')),
  source_code            text NOT NULL REFERENCES ref.source,
  note                   text,
  created_changeset_id   bigint NOT NULL REFERENCES app.changeset,
  withdrawn_changeset_id bigint REFERENCES app.changeset,   -- a trip entered by mistake is withdrawn; its row stays
  UNIQUE (trip_id, route_id, version_no),
  FOREIGN KEY (route_id, version_no) REFERENCES app.route_version
);
-- One observed time at one place of the trip. The clock time and the zone are kept as seen.
CREATE TABLE app.trip_time (
  trip_id              bigint NOT NULL,
  route_id             uuid NOT NULL,
  version_no           integer NOT NULL,
  stop_no              smallint NOT NULL,
  event                text NOT NULL CHECK (event IN ('released', 'pulled', 'departed', 'arrived', 'interchanged', 'placed')),
  at_local             timestamp NOT NULL,                  -- the clock time as seen
  tz                   text NOT NULL,                       -- IANA zone of the place: 'America/Chicago'
  at                   timestamptz NOT NULL,                -- the instant; the app computes it from at_local and tz
  precision            text NOT NULL CHECK (precision IN ('minute', 'hour', 'day')),
  seen_how             text NOT NULL CHECK (seen_how <> ''),  -- 'company tracking screen', 'shop phone call'
  created_changeset_id bigint NOT NULL REFERENCES app.changeset,
  PRIMARY KEY (trip_id, stop_no, event),
  FOREIGN KEY (trip_id, route_id, version_no) REFERENCES app.trip (trip_id, route_id, version_no),
  FOREIGN KEY (route_id, version_no, stop_no) REFERENCES app.route_stop
);
-- Door to door per trip, and per route version: count and spread (P10, P50, P90).
CREATE VIEW app.trip_span AS
SELECT t.trip_id, t.route_id, t.version_no, t.load_status,
       min(tt.at) FILTER (WHERE tt.stop_no = 1) AS left_at,
       max(tt.at) FILTER (WHERE tt.stop_no = s.last_stop) AS reached_at,
       extract(epoch FROM max(tt.at) FILTER (WHERE tt.stop_no = s.last_stop) - min(tt.at) FILTER (WHERE tt.stop_no = 1)) / 3600 AS hours,
       max(CASE tt.precision WHEN 'day' THEN 24 WHEN 'hour' THEN 1 ELSE 0 END) AS worst_precision_h
FROM app.trip t
JOIN app.trip_time tt USING (trip_id)
JOIN (SELECT route_id, version_no, max(stop_no) AS last_stop FROM app.route_stop GROUP BY 1, 2) s
  ON s.route_id = t.route_id AND s.version_no = t.version_no
WHERE t.withdrawn_changeset_id IS NULL
GROUP BY t.trip_id, t.route_id, t.version_no, t.load_status;
CREATE VIEW app.route_observed AS
SELECT route_id, version_no, load_status, count(*) AS trips,
       percentile_cont(0.1) WITHIN GROUP (ORDER BY hours) AS p10_h,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS p50_h,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY hours) AS p90_h,
       min(left_at) AS first_trip, max(left_at) AS last_trip
FROM app.trip_span
WHERE hours IS NOT NULL
GROUP BY route_id, version_no, load_status;
