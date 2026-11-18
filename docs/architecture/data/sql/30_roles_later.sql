-- Roles: LATER, when a second person or the company server arrives. A second layer under the triggers.
-- Tables are owned by a migration role; the server never connects as the owner.
CREATE ROLE visnarn_app NOLOGIN;      -- the server
CREATE ROLE visnarn_loader NOLOGIN;   -- the weekly update: the only writer of net
CREATE ROLE visnarn_obs NOLOGIN;      -- event ingest and derivation
CREATE ROLE visnarn_read NOLOGIN;     -- analysts: SQL, QGIS, BI

GRANT USAGE ON SCHEMA ref, net, app, stat TO visnarn_app, visnarn_read, visnarn_loader, visnarn_obs;
GRANT SELECT ON ALL TABLES IN SCHEMA ref, net, app TO visnarn_app, visnarn_read, visnarn_obs;
GRANT SELECT ON ALL TABLES IN SCHEMA stat TO visnarn_app, visnarn_read;

-- net: insert, then only close. Nothing is deleted.
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA net TO visnarn_loader;
GRANT INSERT ON ref.carrier, ref.city TO visnarn_loader;
GRANT UPDATE (gone_release_id) ON net.node_version, net.segment_version TO visnarn_loader;
GRANT UPDATE (gone_build_id) ON net.segment_build TO visnarn_loader;
GRANT UPDATE (status, loaded_at) ON net.release TO visnarn_loader;
GRANT UPDATE (validated_at, live_from, live_to, rejected_reason) ON net.build TO visnarn_loader;
GRANT DELETE, TRUNCATE ON net.stage_segment, net.stage_build_segment TO visnarn_loader;
GRANT INSERT ON app.route_check TO visnarn_loader;
GRANT UPDATE (checked_build_id, detached_build_id) ON app.shop_link TO visnarn_loader;

-- app: labels may be edited; links, versions and their rows are inserted and then only stamped.
GRANT INSERT ON ALL TABLES IN SCHEMA app TO visnarn_app;
GRANT UPDATE (name, code, geom, anchor_fra_node_id, anchor_line_id, company_mark, splc, serving_carrier_code,
              rev_no, changed_changeset_id, retired_changeset_id) ON app.shop TO visnarn_app;
GRANT UPDATE (confirmed_changeset_id, closed_changeset_id) ON app.shop_link TO visnarn_app;
GRANT UPDATE (name, rev_no, changed_changeset_id, retired_changeset_id) ON app.route TO visnarn_app;
GRANT UPDATE (sealed, closed_changeset_id) ON app.route_version TO visnarn_app;
GRANT UPDATE (seen_changeset_id) ON app.route_check TO visnarn_app;
GRANT DELETE ON app.route_check TO visnarn_app;   -- derived: may be rebuilt
GRANT UPDATE (withdrawn_changeset_id) ON app.trip TO visnarn_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO visnarn_app;

-- obs: as received is insert only; derived rows are rebuilt. The server and analysts never read obs.
GRANT USAGE ON SCHEMA obs TO visnarn_obs;
GRANT SELECT, INSERT ON obs.feed, obs.ingest_batch, obs.raw_message, obs.equipment, obs.car_event, obs.junction_advice,
                        obs.derivation_run TO visnarn_obs;
GRANT UPDATE (finished_at) ON obs.derivation_run TO visnarn_obs;
GRANT SELECT, INSERT, DELETE ON obs.event_match, obs.event_issue, obs.movement TO visnarn_obs;
GRANT SELECT, INSERT, DELETE ON ALL TABLES IN SCHEMA stat TO visnarn_obs;
GRANT UPDATE (finished_at, published_at) ON stat.stat_run TO visnarn_obs;
GRANT UPDATE (gone_build_id) ON stat.stretch_track TO visnarn_obs;
