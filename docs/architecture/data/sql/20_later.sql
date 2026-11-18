-- VisNARN data architecture, LATER. Agreed on paper now; each table is created when its first reader exists.
-- obs is created only after the company agrees in writing that car-movement data may be held here.

CREATE SCHEMA obs;    -- car events as received, and what we derive per car; its own role
CREATE SCHEMA stat;   -- statistics and estimates; no car identity, readable by the app

-- ============================================================ ref: industry codes
-- Other names one railroad is reported under: a feed may say CPRS where NARN says CPKC.
CREATE TABLE ref.carrier_alias (
  alias_system text NOT NULL CHECK (alias_system IN ('reporting_mark', 'scac', 'umler_mark', 'company')),
  alias        text NOT NULL,
  carrier_code text NOT NULL REFERENCES ref.carrier,
  valid        daterange NOT NULL DEFAULT daterange(NULL, NULL),
  source_code  text NOT NULL REFERENCES ref.source,
  EXCLUDE USING gist (alias_system WITH =, alias WITH =, valid WITH &&)
);

-- A station: the place an event or a code names. One 9-digit SPLC is one station; a city-level SPLC (sub-code 000)
-- is a station that may hold dozens of sites, which app.station_anchor lists.
CREATE TABLE ref.station (
  station_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  splc        text UNIQUE CHECK (splc ~ '^[0-9]{9}$'),
  splc_city   text GENERATED ALWAYS AS (left(splc, 6)) STORED,
  city_level  boolean GENERATED ALWAYS AS (right(splc, 3) = '000') STORED,
  name        text NOT NULL,
  region      text,
  country     text CHECK (country IN ('US', 'CA', 'MX')),   -- verify the Mexican SPLC layout before loading MX
  tz          text,                                          -- IANA zone: turns a local event time into an instant
  geom        geometry(Point, 4326),                         -- only when a source gives one; never guessed
  source_code text NOT NULL REFERENCES ref.source,
  as_of       date NOT NULL
);
CREATE INDEX station_by_city ON ref.station (splc_city);

-- Every other way a station is named: a railroad's FSAC, the 9-letter city of a location message, the company's own code.
CREATE TABLE ref.station_code (
  station_id   integer NOT NULL REFERENCES ref.station,
  code_system  text NOT NULL CHECK (code_system IN ('fsac', 'clm_name', 'company')),
  carrier_code text REFERENCES ref.carrier,      -- fsac: the railroad that assigned it
  region       text,                             -- clm_name: the state or province sent with it
  code         text NOT NULL,
  valid        daterange NOT NULL DEFAULT daterange(NULL, NULL),   -- an FSAC is not reused for 3 years
  source_code  text NOT NULL REFERENCES ref.source,
  CHECK (code_system <> 'fsac' OR (code ~ '^[0-9]{5}$' AND carrier_code IS NOT NULL)),
  CHECK (code_system <> 'clm_name' OR (char_length(code) <= 9 AND region IS NOT NULL)),
  EXCLUDE USING gist (code_system WITH =, (coalesce(carrier_code, '')) WITH =, (coalesce(region, '')) WITH =,
                      code WITH =, valid WITH &&)
);

-- A Rule 260 junction: up to 5 letters, tied to an SPLC.
CREATE TABLE ref.junction (
  junction_id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  junction_code text NOT NULL CHECK (junction_code ~ '^[A-Z]{1,5}$'),
  station_id    integer NOT NULL REFERENCES ref.station,
  valid         daterange NOT NULL DEFAULT daterange(NULL, NULL),
  source_code   text NOT NULL REFERENCES ref.source,
  UNIQUE (junction_id, station_id),
  EXCLUDE USING gist (junction_code WITH =, valid WITH &&)
);
CREATE TABLE ref.interchange_type (
  interchange_type char(1) PRIMARY KEY CHECK (interchange_type ~ '^[A-Z]$'),   -- C I N O P R S V W
  meaning          text NOT NULL
);
-- A registered interchange: one type per carrier pair per station at a time.
CREATE TABLE ref.interchange (
  interchange_id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  junction_id      integer NOT NULL,
  station_id       integer NOT NULL,
  carrier_a        text NOT NULL REFERENCES ref.carrier,
  carrier_b        text NOT NULL REFERENCES ref.carrier,
  interchange_type char(1) NOT NULL REFERENCES ref.interchange_type,
  valid            daterange NOT NULL,
  source_code      text NOT NULL REFERENCES ref.source,
  FOREIGN KEY (junction_id, station_id) REFERENCES ref.junction (junction_id, station_id),   -- same station as its junction
  CHECK (carrier_a < carrier_b),
  EXCLUDE USING gist (station_id WITH =, carrier_a WITH =, carrier_b WITH =, valid WITH &&)
);

-- Event codes as each code set defines them, and the class our derivation gives them.
CREATE TABLE ref.event_code (
  code_set    text NOT NULL,       -- 'clm' (A arrival, P departure, J/R interchange, W release, X pull, Y/Z placement ...)
  event_code  text NOT NULL,
  meaning     text NOT NULL,
  event_class text NOT NULL CHECK (event_class IN ('arrive', 'arrive_destination', 'depart', 'pass', 'interchange_deliver',
                'interchange_receive', 'release', 'pull', 'constructive_placement', 'placement', 'bad_order', 'eta', 'other')),
  PRIMARY KEY (code_set, event_code)
);
-- How two consecutive events of one car become a movement. Rows, so the rule is read and changed without code.
CREATE TABLE ref.movement_rule (
  from_class   text NOT NULL,
  to_class     text NOT NULL,
  same_station boolean NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('run', 'dwell', 'interchange', 'first_mile', 'last_mile', 'mixed', 'ignore')),
  PRIMARY KEY (from_class, to_class, same_station)
);

ALTER TABLE app.route_leg ADD COLUMN junction_id integer REFERENCES ref.junction;   -- the Rule 260 junction of the hand-off

-- Where a station sits on the network. Many sites per station; the role says which events use which site.
CREATE TABLE app.station_anchor (
  station_anchor_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station_id             integer NOT NULL REFERENCES ref.station,
  carrier_code           text REFERENCES ref.carrier,          -- the railroad whose events use it; NULL: any
  role                   text NOT NULL CHECK (role IN ('yard', 'station', 'junction', 'industry', 'shop')),
  fra_node_id            integer REFERENCES net.node,
  fraarcid               integer REFERENCES net.segment,
  fraction               double precision CHECK (fraction > 0 AND fraction < 1),
  method                 text NOT NULL CHECK (method IN ('code', 'name', 'nearest', 'person')),
  confidence             real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  checked_build_id       integer NOT NULL REFERENCES net.build,
  created_changeset_id   bigint NOT NULL REFERENCES app.changeset,
  confirmed_changeset_id bigint REFERENCES app.changeset,
  detached_build_id      integer REFERENCES net.build,
  closed_changeset_id    bigint REFERENCES app.changeset,
  CHECK (num_nonnulls(fra_node_id, fraarcid) = 1),
  CHECK ((fraarcid IS NULL) = (fraction IS NULL))
);
CREATE INDEX station_anchor_by_station ON app.station_anchor (station_id, role) WHERE closed_changeset_id IS NULL;

-- Counts of deliberate actions per week, by stable id. No person, no day: in a team of three a daily count points at one person.
CREATE TABLE app.usage_weekly (
  week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),   -- the Monday
  action     text NOT NULL CHECK (action IN ('route_saved', 'route_opened', 'place_chosen', 'route_exported')),
  shop_id    uuid REFERENCES app.shop,
  route_id   uuid REFERENCES app.route,
  fra_node_id integer REFERENCES net.node,
  city_id    integer REFERENCES ref.city,
  n          integer NOT NULL CHECK (n > 0),
  CHECK (num_nonnulls(shop_id, route_id, fra_node_id, city_id) = 1)
);
CREATE UNIQUE INDEX usage_weekly_key ON app.usage_weekly
  (week_start, action, coalesce(shop_id::text, route_id::text, 'n' || fra_node_id, 'c' || city_id));

-- ============================================================ obs layer 1: as received (append only)
CREATE TABLE obs.feed (
  feed_code   text PRIMARY KEY CHECK (feed_code ~ '^[a-z][a-z0-9_]{1,39}$'),   -- 'company_clm', 'junction_advice', 'manual'
  title       text NOT NULL,
  source_code text NOT NULL REFERENCES ref.source,
  code_set    text NOT NULL,                     -- the ref.event_code set its codes belong to
  time_basis  text NOT NULL CHECK (time_basis IN ('local_at_location', 'utc', 'fixed_zone', 'unknown')),
  fixed_zone  text,
  entitlement text NOT NULL,                     -- the agreement that lets this database hold the feed
  CHECK ((time_basis = 'fixed_zone') = (fixed_zone IS NOT NULL))
);
CREATE TABLE obs.ingest_batch (
  batch_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feed_code      text NOT NULL REFERENCES obs.feed,
  origin         text NOT NULL,                  -- file name, queue, API call or company table
  received_at    timestamptz NOT NULL,
  loaded_at      timestamptz NOT NULL DEFAULT now(),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  record_count   integer NOT NULL CHECK (record_count >= 0),
  loader_version text NOT NULL,
  UNIQUE (feed_code, sha256)                     -- loading one file twice is refused
);
-- Each message exactly as it arrived: the evidence. The only free-form column in the database.
CREATE TABLE obs.raw_message (
  batch_id  bigint NOT NULL REFERENCES obs.ingest_batch,
  record_no integer NOT NULL CHECK (record_no >= 1),
  body      bytea NOT NULL,                      -- bytes, so a bad character can never stop a load
  PRIMARY KEY (batch_id, record_no)
);
-- Car identity lives in one table, so every other table can be shared without it.
CREATE TABLE obs.equipment (
  equipment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  car_initial  text NOT NULL CHECK (car_initial ~ '^[A-Z]{2,4}$'),
  car_number   integer NOT NULL CHECK (car_number BETWEEN 0 AND 999999),
  UNIQUE (car_initial, car_number)
);
-- One reported event, typed, with nothing interpreted. Unknown codes and places are stored too; matching flags them.
CREATE TABLE obs.car_event (
  event_id             bigint GENERATED ALWAYS AS IDENTITY,
  event_local          timestamp NOT NULL,       -- wall-clock time at the place, as far as it was sent
  feed_code            text NOT NULL REFERENCES obs.feed,
  batch_id             bigint NOT NULL,
  record_no            integer NOT NULL,
  equipment_id         bigint NOT NULL REFERENCES obs.equipment,
  event_code           text NOT NULL,            -- no FK: an unknown code is kept and flagged
  road_mark            text NOT NULL CHECK (road_mark ~ '^[A-Z]{2,4}$'),   -- the reporting railroad as sent
  loc_splc             text CHECK (loc_splc ~ '^[0-9]{9}$'),               -- no FK: an unknown SPLC is kept and flagged
  loc_name             text,
  loc_region           text,
  loc_key              text GENERATED ALWAYS AS (coalesce(loc_splc, loc_name || '|' || loc_region)) STORED,
  load_status          text CHECK (load_status IN ('L', 'E')),
  train_id             text,
  zone_sent            text,                     -- the zone letter or name, when the format carries one
  time_precision       text NOT NULL CHECK (time_precision IN ('minute', 'hour')),
  date_inferred        boolean NOT NULL,         -- the year was not sent and comes from received_at
  received_at          timestamptz NOT NULL,
  loaded_at            timestamptz NOT NULL DEFAULT now(),
  corrects_event_id    bigint,                   -- the earlier row this one replaces
  corrects_event_local timestamp,
  PRIMARY KEY (event_id, event_local),
  UNIQUE (feed_code, equipment_id, event_local, event_code, road_mark, loc_key),   -- per feed; duplicates across feeds are found later
  FOREIGN KEY (batch_id, record_no) REFERENCES obs.raw_message,
  FOREIGN KEY (corrects_event_id, corrects_event_local) REFERENCES obs.car_event (event_id, event_local),
  CHECK (loc_splc IS NOT NULL OR (loc_name IS NOT NULL AND loc_region IS NOT NULL)),
  CHECK ((corrects_event_id IS NULL) = (corrects_event_local IS NULL))
) PARTITION BY RANGE (event_local);
CREATE TABLE obs.car_event_default PARTITION OF obs.car_event DEFAULT;   -- monthly partitions are added ahead of time
CREATE INDEX car_event_by_car ON obs.car_event (equipment_id, event_local);
CREATE INDEX car_event_loaded ON obs.car_event (loaded_at);

-- A junction advice: one verified hand-off between two railroads, with a real time.
CREATE TABLE obs.junction_advice (
  advice_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  feed_code         text NOT NULL REFERENCES obs.feed,
  batch_id          bigint NOT NULL,
  record_no         integer NOT NULL,
  equipment_id      bigint NOT NULL REFERENCES obs.equipment,
  junction_code     text NOT NULL,              -- as sent; matched to ref.junction later
  delivering_mark   text NOT NULL,
  receiving_mark    text NOT NULL,
  interchange_local timestamp NOT NULL,
  zone_sent         text,
  received_at       timestamptz NOT NULL,
  loaded_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (batch_id, record_no) REFERENCES obs.raw_message,
  UNIQUE (feed_code, equipment_id, junction_code, interchange_local, delivering_mark, receiving_mark),
  CHECK (delivering_mark <> receiving_mark)
);

-- ============================================================ obs layer 2: matched (derived, rebuilt by a run)
CREATE TABLE obs.derivation_run (
  run_id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  step           text NOT NULL CHECK (step IN ('match', 'movement')),
  code_version   text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  loaded_through timestamptz NOT NULL            -- every event with loaded_at up to here was read
);
-- What we make of one event: which class, railroad, station (and how sure), which site, which instant.
CREATE TABLE obs.event_match (
  event_id                 bigint NOT NULL,
  event_local              timestamp NOT NULL,
  run_id                   integer NOT NULL REFERENCES obs.derivation_run,
  usable                   boolean NOT NULL,
  unusable_because         text CHECK (unusable_because IN ('corrected', 'duplicate', 'unknown_code', 'unknown_road',
                             'unknown_place', 'ambiguous_place', 'unknown_zone', 'out_of_order')),
  duplicate_of_event_id    bigint,               -- the same event from another feed
  duplicate_of_event_local timestamp,
  event_class              text,
  carrier_code             text REFERENCES ref.carrier,
  station_id               integer REFERENCES ref.station,
  station_method           text CHECK (station_method IN ('splc', 'splc_city', 'name', 'person')),
  station_confidence       real CHECK (station_confidence BETWEEN 0 AND 1),
  station_anchor_id        bigint REFERENCES app.station_anchor,
  event_at                 timestamptz,          -- the instant, from event_local and the station's zone
  lag_s                    integer,              -- received_at minus event_at: the reporting delay
  PRIMARY KEY (event_id, event_local),
  FOREIGN KEY (event_id, event_local) REFERENCES obs.car_event,
  FOREIGN KEY (duplicate_of_event_id, duplicate_of_event_local) REFERENCES obs.car_event (event_id, event_local),
  CHECK (usable = (unusable_because IS NULL)),
  CHECK ((unusable_because = 'duplicate') = (duplicate_of_event_id IS NOT NULL)),
  CHECK (NOT usable OR (carrier_code IS NOT NULL AND station_id IS NOT NULL AND event_at IS NOT NULL))
) PARTITION BY RANGE (event_local);
CREATE TABLE obs.event_match_default PARTITION OF obs.event_match DEFAULT;
CREATE INDEX event_match_by_station ON obs.event_match (station_id, event_at) WHERE usable;

-- Flags that do not block use. Counted per feed and railroad, they show which source to trust less.
CREATE TABLE obs.event_issue (
  event_id    bigint NOT NULL,
  event_local timestamp NOT NULL,
  run_id      integer NOT NULL REFERENCES obs.derivation_run,
  issue       text NOT NULL CHECK (issue IN ('year_inferred', 'zone_from_station', 'hour_only', 'received_before_event',
                'late_over_1_day', 'mark_via_alias', 'place_city_level')),
  detail      text,
  PRIMARY KEY (event_id, event_local, issue),
  FOREIGN KEY (event_id, event_local) REFERENCES obs.car_event
);

-- ============================================================ stat: stretches
-- A stretch: one railroad, from one station to the next it reports. Ordered, so direction is in the key.
CREATE TABLE stat.stretch (
  stretch_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_code    text NOT NULL REFERENCES ref.carrier,
  from_station_id integer NOT NULL REFERENCES ref.station,
  to_station_id   integer NOT NULL REFERENCES ref.station,
  UNIQUE (carrier_code, from_station_id, to_station_id),
  CHECK (from_station_id <> to_station_id)
);
-- The track a stretch is assumed to follow. The path between two events is not observed: this is a routed guess
-- with a confidence, kept once per stretch and remade only when a build changes one of its segments.
CREATE TABLE stat.stretch_track (
  stretch_id        bigint NOT NULL REFERENCES stat.stretch,
  first_build_id    integer NOT NULL REFERENCES net.build,
  gone_build_id     integer REFERENCES net.build,
  method            text NOT NULL CHECK (method IN ('routed', 'gps_matched', 'person')),
  confidence        real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  length_km         double precision NOT NULL CHECK (length_km > 0),
  near_alternatives smallint NOT NULL CHECK (near_alternatives >= 0),   -- other ways within a few percent of the length
  PRIMARY KEY (stretch_id, first_build_id),
  EXCLUDE USING gist (stretch_id WITH =, int4range(first_build_id, gone_build_id) WITH &&)
);
CREATE UNIQUE INDEX stretch_track_now ON stat.stretch_track (stretch_id) WHERE gone_build_id IS NULL;
CREATE TABLE stat.stretch_segment (
  stretch_id     bigint NOT NULL,
  first_build_id integer NOT NULL,
  seq            integer NOT NULL CHECK (seq >= 1),
  fraarcid       integer NOT NULL REFERENCES net.segment,
  forward        boolean NOT NULL,
  from_fraction  double precision NOT NULL DEFAULT 0,
  to_fraction    double precision NOT NULL DEFAULT 1,
  length_km      double precision NOT NULL CHECK (length_km > 0),
  PRIMARY KEY (stretch_id, first_build_id, seq),
  FOREIGN KEY (stretch_id, first_build_id) REFERENCES stat.stretch_track,
  CHECK (0 <= from_fraction AND from_fraction < to_fraction AND to_fraction <= 1)
);
CREATE INDEX stretch_segment_by_segment ON stat.stretch_segment (fraarcid);

-- ============================================================ obs layer 3: movements (derived)
-- One row per pair of consecutive usable events of one car. A time belongs to a movement between two events.
CREATE TABLE obs.movement (
  movement_id     bigint GENERATED ALWAYS AS IDENTITY,
  started_local   timestamp NOT NULL,
  run_id          integer NOT NULL REFERENCES obs.derivation_run,
  equipment_id    bigint NOT NULL REFERENCES obs.equipment,
  from_event_id   bigint NOT NULL,
  to_event_id     bigint NOT NULL,
  ended_local     timestamp NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('run', 'dwell', 'interchange', 'first_mile', 'last_mile', 'mixed')),
  carrier_code    text NOT NULL REFERENCES ref.carrier,   -- the railroad holding the car at the start
  to_carrier_code text REFERENCES ref.carrier,            -- interchange: the railroad receiving it
  from_station_id integer NOT NULL REFERENCES ref.station,
  to_station_id   integer NOT NULL REFERENCES ref.station,
  stretch_id      bigint REFERENCES stat.stretch,         -- run or mixed
  started_at      timestamptz NOT NULL,
  ended_at        timestamptz NOT NULL,
  duration_s      integer GENERATED ALWAYS AS (extract(epoch FROM (ended_at - started_at))::integer) STORED,
  load_status     text CHECK (load_status IN ('L', 'E')),
  train_id        text,
  precision_s     integer NOT NULL CHECK (precision_s >= 60),   -- 60 when both events carry minutes, 3600 when one has the hour only
  PRIMARY KEY (movement_id, started_local),
  FOREIGN KEY (from_event_id, started_local) REFERENCES obs.car_event (event_id, event_local),
  FOREIGN KEY (to_event_id, ended_local) REFERENCES obs.car_event (event_id, event_local),
  CHECK (ended_at >= started_at),
  CHECK ((kind IN ('run', 'mixed')) = (stretch_id IS NOT NULL)),
  CHECK ((kind = 'interchange') = (to_carrier_code IS NOT NULL)),
  CHECK (kind IN ('run', 'mixed') OR from_station_id = to_station_id)
) PARTITION BY RANGE (started_local);
CREATE TABLE obs.movement_default PARTITION OF obs.movement DEFAULT;
CREATE INDEX movement_by_car ON obs.movement (equipment_id, started_at);
CREATE INDEX movement_by_stretch ON obs.movement (stretch_id, started_at) WHERE stretch_id IS NOT NULL;
CREATE INDEX movement_by_station ON obs.movement (from_station_id, kind, started_at) WHERE stretch_id IS NULL;

-- ============================================================ stat: statistics (each run is written whole, then left as it is)
CREATE TABLE stat.stat_run (
  stat_run_id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code_version    text NOT NULL,
  movement_run_id integer NOT NULL REFERENCES obs.derivation_run,
  window_from     date NOT NULL,
  window_to       date NOT NULL,
  min_n           integer NOT NULL CHECK (min_n >= 1),        -- groups below it are not written (privacy and noise)
  pool_min_n      integer NOT NULL CHECK (pool_min_n >= 1),   -- a stretch needs this many runs to stand alone (rule of thumb: 30)
  pool_min_cars   integer NOT NULL CHECK (pool_min_cars >= 1),-- and this many distinct cars (30 runs of one car are one car)
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  published_at    timestamptz,                                -- readers use the latest published run
  CHECK (window_to > window_from)
);
-- Running time per stretch. quarter 0 = the whole window; load_status '*' = loaded and empty together.
CREATE TABLE stat.run_time (
  run_time_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stat_run_id integer NOT NULL REFERENCES stat.stat_run,
  stretch_id  bigint NOT NULL REFERENCES stat.stretch,
  load_status text NOT NULL CHECK (load_status IN ('L', 'E', '*')),
  quarter     smallint NOT NULL CHECK (quarter BETWEEN 0 AND 4),
  n           integer NOT NULL CHECK (n >= 1),
  n_cars      integer NOT NULL CHECK (n_cars BETWEEN 1 AND n),
  mean_s      integer NOT NULL CHECK (mean_s >= 0),
  p10_s       integer NOT NULL CHECK (p10_s >= 0),
  p50_s       integer NOT NULL,
  p90_s       integer NOT NULL,
  UNIQUE (stat_run_id, stretch_id, load_status, quarter),
  CHECK (p10_s <= p50_s AND p50_s <= p90_s)
);
-- Time spent at a place: yard dwell, interchange, release to pull, arrival to placement. Never mixed with running time.
CREATE TABLE stat.dwell_time (
  dwell_time_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stat_run_id     integer NOT NULL REFERENCES stat.stat_run,
  station_id      integer NOT NULL REFERENCES ref.station,
  kind            text NOT NULL CHECK (kind IN ('dwell', 'interchange', 'first_mile', 'last_mile')),
  carrier_code    text NOT NULL REFERENCES ref.carrier,
  to_carrier_code text REFERENCES ref.carrier,
  load_status     text NOT NULL CHECK (load_status IN ('L', 'E', '*')),
  quarter         smallint NOT NULL CHECK (quarter BETWEEN 0 AND 4),
  n               integer NOT NULL CHECK (n >= 1),
  n_cars          integer NOT NULL CHECK (n_cars BETWEEN 1 AND n),
  mean_s          integer NOT NULL CHECK (mean_s >= 0),
  p10_s           integer NOT NULL CHECK (p10_s >= 0),
  p50_s           integer NOT NULL,
  p90_s           integer NOT NULL,
  CHECK (p10_s <= p50_s AND p50_s <= p90_s),
  CHECK ((kind = 'interchange') = (to_carrier_code IS NOT NULL))
);
CREATE UNIQUE INDEX dwell_time_key ON stat.dwell_time
  (stat_run_id, station_id, kind, carrier_code, coalesce(to_carrier_code, ''), load_status, quarter);
-- Thin data pools upward: speed per railroad and length band, then the whole network (carrier NULL).
CREATE TABLE stat.speed_pool (
  speed_pool_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stat_run_id   integer NOT NULL REFERENCES stat.stat_run,
  carrier_code  text REFERENCES ref.carrier,
  km_from       integer NOT NULL CHECK (km_from >= 0),
  km_to         integer NOT NULL,
  load_status   text NOT NULL CHECK (load_status IN ('L', 'E', '*')),
  n             integer NOT NULL CHECK (n >= 1),
  p10_kmh       real NOT NULL CHECK (p10_kmh > 0),
  p50_kmh       real NOT NULL,
  p90_kmh       real NOT NULL,
  CHECK (km_to > km_from),
  CHECK (p10_kmh <= p50_kmh AND p50_kmh <= p90_kmh)
);
CREATE UNIQUE INDEX speed_pool_key ON stat.speed_pool (stat_run_id, coalesce(carrier_code, ''), km_from, load_status);
-- Public starting values (STB EP 724 speed and dwell, the Chicago gateway, the 2006 placement study), each with source and date.
CREATE TABLE stat.prior (
  prior_id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quantity     text NOT NULL CHECK (quantity IN ('run_kmh', 'dwell_h', 'interchange_h', 'first_mile_h', 'last_mile_h')),
  carrier_code text REFERENCES ref.carrier,
  station_id   integer REFERENCES ref.station,
  p10          double precision,
  p50          double precision NOT NULL CHECK (p50 > 0),
  p90          double precision,
  source_code  text NOT NULL REFERENCES ref.source,
  source_ref   text NOT NULL,                    -- 'EP 724, 13-week mean to 2026-11-11'
  definition   text NOT NULL,                    -- what the source means by it: sources define dwell differently
  as_of        date NOT NULL
);

CREATE VIEW stat.published_run AS
SELECT * FROM stat.stat_run WHERE stat_run_id = (SELECT max(stat_run_id) FROM stat.stat_run WHERE published_at IS NOT NULL);

-- Running time per stretch, with the pool level that supplied it. Thresholds come from the run's own columns.
CREATE VIEW stat.run_estimate AS
SELECT s.stretch_id, ls.load_status, k.length_km,
       CASE WHEN rt.run_time_id IS NOT NULL THEN 'stretch' WHEN sp.speed_pool_id IS NOT NULL THEN 'carrier'
            WHEN np.speed_pool_id IS NOT NULL THEN 'network' ELSE 'none' END AS pool_level,
       rt.run_time_id, coalesce(sp.speed_pool_id, np.speed_pool_id) AS speed_pool_id,
       coalesce(rt.n, sp.n, np.n) AS n,
       coalesce(rt.p10_s, k.length_km / coalesce(sp.p90_kmh, np.p90_kmh) * 3600) AS p10_s,
       coalesce(rt.p50_s, k.length_km / coalesce(sp.p50_kmh, np.p50_kmh) * 3600) AS p50_s,
       coalesce(rt.p90_s, k.length_km / coalesce(sp.p10_kmh, np.p10_kmh) * 3600) AS p90_s
FROM stat.stretch s
CROSS JOIN stat.published_run pr
CROSS JOIN (VALUES ('L'), ('E')) AS ls(load_status)
JOIN stat.stretch_track k ON k.stretch_id = s.stretch_id AND k.gone_build_id IS NULL
LEFT JOIN stat.run_time rt ON rt.stat_run_id = pr.stat_run_id AND rt.stretch_id = s.stretch_id
     AND rt.load_status = ls.load_status AND rt.quarter = 0 AND rt.n >= pr.pool_min_n AND rt.n_cars >= pr.pool_min_cars
LEFT JOIN stat.speed_pool sp ON sp.stat_run_id = pr.stat_run_id AND sp.carrier_code = s.carrier_code
     AND sp.load_status = ls.load_status AND k.length_km >= sp.km_from AND k.length_km < sp.km_to AND sp.n >= pr.pool_min_n
LEFT JOIN stat.speed_pool np ON np.stat_run_id = pr.stat_run_id AND np.carrier_code IS NULL
     AND np.load_status = ls.load_status AND k.length_km >= np.km_from AND k.length_km < np.km_to;

-- A per-segment time is only the stretch time shared out by length. It is a view, labelled, and never stored.
CREATE VIEW stat.segment_time_allocated AS
SELECT g.fraarcid, g.forward, e.stretch_id, e.load_status, e.pool_level, e.n,
       e.p50_s * g.length_km / e.length_km AS p50_s, 'allocated_by_length'::text AS method, k.confidence AS track_confidence
FROM stat.run_estimate e
JOIN stat.stretch_track k ON k.stretch_id = e.stretch_id AND k.gone_build_id IS NULL
JOIN stat.stretch_segment g ON g.stretch_id = k.stretch_id AND g.first_build_id = k.first_build_id
WHERE e.pool_level <> 'none';

-- An estimate for a saved route, and exactly which statistic rows it used.
CREATE TABLE stat.eta_estimate (
  eta_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_id    uuid NOT NULL,
  version_no  integer NOT NULL,
  stat_run_id integer NOT NULL REFERENCES stat.stat_run,
  load_status text NOT NULL CHECK (load_status IN ('L', 'E')),
  method      text NOT NULL CHECK (method IN ('monte_carlo', 'sum_of_medians')),   -- a sum of P90s overstates P90
  p10_h       real NOT NULL,
  p50_h       real NOT NULL,
  p90_h       real NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (route_id, version_no) REFERENCES app.route_version,
  CHECK (p10_h <= p50_h AND p50_h <= p90_h)
);
CREATE TABLE stat.eta_component (
  eta_id        bigint NOT NULL REFERENCES stat.eta_estimate,
  seq           smallint NOT NULL CHECK (seq >= 1),
  kind          text NOT NULL CHECK (kind IN ('first_mile', 'run', 'dwell', 'interchange', 'last_mile')),
  run_time_id   bigint REFERENCES stat.run_time,
  dwell_time_id bigint REFERENCES stat.dwell_time,
  speed_pool_id bigint REFERENCES stat.speed_pool,
  prior_id      integer REFERENCES stat.prior,
  pool_level    text NOT NULL CHECK (pool_level IN ('stretch', 'place', 'carrier', 'network', 'public_prior')),
  p50_h         real NOT NULL,
  PRIMARY KEY (eta_id, seq),
  CHECK (num_nonnulls(run_time_id, dwell_time_id, speed_pool_id, prior_id) = 1)
);
