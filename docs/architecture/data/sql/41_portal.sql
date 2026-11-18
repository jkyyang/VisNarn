-- VisNARN many-user portal: additions to the data architecture (revised after review). Replaces manyuser/sql/40_many_users.sql.
-- Runs after 10_now.sql, 20_later.sql and 30_roles_later.sql. Stage 2 (team server) unless marked.

-- ============================================================ people from the company sign-in
-- The identity comes from the company sign-in (an authenticating gateway or OIDC). The server copies the
-- person's role from the IdP's app roles or groups at each sign-in. Nobody types a role into the portal.
-- Entra ID: idp_issuer carries the tenant id and idp_subject the object id (oid), not 'sub'.
ALTER TABLE app.person
  ADD COLUMN idp_issuer      text,
  ADD COLUMN idp_subject     text,
  ADD COLUMN email           text CHECK (email = lower(email)),
  ADD COLUMN role            text CHECK (role IN ('viewer', 'planner', 'shop_editor', 'admin')),  -- NULL: no access (default deny)
  ADD COLUMN role_synced_at  timestamptz,
  ADD COLUMN last_sign_in_at timestamptz,
  ADD COLUMN sessions_valid_after timestamptz,          -- a session issued before this is refused ("end all sessions")
  ADD CONSTRAINT person_idp_pair CHECK ((idp_issuer IS NULL) = (idp_subject IS NULL));
CREATE UNIQUE INDEX person_idp_key ON app.person (idp_issuer, idp_subject) WHERE idp_subject IS NOT NULL;

-- ============================================================ audit log, partitioned by month
-- Records what writes no data row. Rows cannot be changed or deleted one by one. Retention drops whole
-- months: the schema owner (the migration role) detaches and drops a partition; the portal cannot.
CREATE TABLE app.audit_event (
  audit_id     bigint GENERATED ALWAYS AS IDENTITY,
  at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  person_id    integer REFERENCES app.person,           -- NULL: a refused sign-in by an unknown person
  action       text NOT NULL CHECK (action IN (
                 'sign_in', 'sign_in_refused', 'sign_out', 'sessions_ended', 'role_changed',
                 'access_refused', 'conflict', 'import', 'export', 'build_released', 'setting_changed')),
  changeset_id bigint REFERENCES app.changeset,         -- the write this event belongs to, if any (never set for 'conflict')
  object_kind  text CHECK (object_kind IN ('shop', 'shop_link', 'route', 'person', 'build', 'setting')),
  object_id    text,
  request_id   text NOT NULL,                           -- the same id as the server's log line
  detail       text CHECK (char_length(detail) <= 500), -- one plain line. Never a car number or a request body
  CHECK ((object_kind IS NULL) = (object_id IS NULL)),
  PRIMARY KEY (audit_id, at)
) PARTITION BY RANGE (at);
CREATE TABLE app.audit_event_default PARTITION OF app.audit_event DEFAULT;   -- a safety net; the monthly job creates real months ahead
CREATE TABLE app.audit_event_2026_11 PARTITION OF app.audit_event FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE app.audit_event_2026_12 PARTITION OF app.audit_event FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE INDEX audit_event_by_person ON app.audit_event (person_id, at DESC);
CREATE INDEX audit_event_by_object ON app.audit_event (object_kind, object_id, at DESC) WHERE object_id IS NOT NULL;

CREATE FUNCTION app.audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the audit log is append only' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON app.audit_event
  FOR EACH ROW EXECUTE FUNCTION app.audit_append_only();

-- ============================================================ old values of a shop (stage 2: history not captured is lost)
CREATE TABLE app.shop_revision (
  shop_id               uuid NOT NULL REFERENCES app.shop,
  rev_no                integer NOT NULL CHECK (rev_no >= 1),
  name                  text NOT NULL,
  code                  text,
  geom                  geometry(Point, 4326) NOT NULL,
  anchor_fra_node_id    integer,
  anchor_line_id        smallint,
  company_mark          text,
  splc                  text,
  serving_carrier_code  text,
  written_changeset_id  bigint NOT NULL REFERENCES app.changeset,
  replaced_changeset_id bigint NOT NULL REFERENCES app.changeset,
  PRIMARY KEY (shop_id, rev_no),
  CHECK (replaced_changeset_id > written_changeset_id)
);
CREATE FUNCTION app.shop_keep_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO app.shop_revision VALUES (OLD.shop_id, OLD.rev_no, OLD.name, OLD.code, OLD.geom, OLD.anchor_fra_node_id,
    OLD.anchor_line_id, OLD.company_mark, OLD.splc, OLD.serving_carrier_code, OLD.changed_changeset_id, NEW.changed_changeset_id);
  RETURN NULL;
END $$;
CREATE TRIGGER shop_keep_revision AFTER UPDATE ON app.shop FOR EACH ROW EXECUTE FUNCTION app.shop_keep_revision();

-- ============================================================ build files inside PostgreSQL (no object storage)
-- About 19.5 MB per build, about 1 GB a year. Backed up with everything else. Select `content` only by name.
ALTER TABLE net.build_artifact
  ADD COLUMN content bytea,
  ADD CONSTRAINT build_artifact_content CHECK (
    content IS NULL OR (octet_length(content) = bytes AND encode(sha256(content), 'hex') = sha256));

-- ============================================================ privileges (with section 4.12)
GRANT SELECT, INSERT ON app.audit_event TO visnarn_app;            -- never update or delete
GRANT SELECT, INSERT ON app.shop_revision TO visnarn_app;
GRANT UPDATE (idp_issuer, idp_subject, email, display_name, role, role_synced_at, last_sign_in_at, sessions_valid_after, active)
  ON app.person TO visnarn_app;
GRANT UPDATE (n) ON app.usage_weekly TO visnarn_app;               -- the in-process counters add to the weekly row
REVOKE SELECT ON app.audit_event, app.person FROM visnarn_read;    -- analysts see no sign-ins, no logins, no e-mail
GRANT SELECT (person_id, display_name, active) ON app.person TO visnarn_read;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO visnarn_app;

-- Login roles: one per process kind. Limits sit on the login role (a group role does not pass ALTER ROLE ... SET on).
CREATE ROLE portal_app LOGIN IN ROLE visnarn_app;
ALTER ROLE portal_app SET statement_timeout = '5s';
ALTER ROLE portal_app SET idle_in_transaction_session_timeout = '10s';
CREATE ROLE portal_jobs LOGIN IN ROLE visnarn_loader, visnarn_app;   -- scheduled jobs: weekly loader, route checks
ALTER ROLE portal_jobs SET statement_timeout = '30min';
CREATE ROLE portal_analyst LOGIN CONNECTION LIMIT 5 IN ROLE visnarn_read;   -- the primary, until a replica is needed
ALTER ROLE portal_analyst SET statement_timeout = '2min';
ALTER ROLE portal_analyst SET default_transaction_read_only = on;
ALTER ROLE portal_analyst SET work_mem = '64MB';
