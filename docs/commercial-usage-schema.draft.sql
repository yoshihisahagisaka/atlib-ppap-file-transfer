-- REVIEW ONLY: outside migrations/, no migration number, no automatic application.
-- Prerequisites: approved tenant schema, organizations(id), and transfers UNIQUE(organization_id,id).
-- Apply only to separately approved isolated DB, never the existing Production DB via this file.
CREATE TABLE send_usage_periods (
 organization_id UUID NOT NULL REFERENCES organizations(id), period_id TEXT NOT NULL,
 allowance JSONB NOT NULL,
 consumed_bytes BIGINT NOT NULL CHECK(consumed_bytes>=0),
 reserved_bytes BIGINT NOT NULL CHECK(reserved_bytes>=0), extra_bytes BIGINT NOT NULL CHECK(extra_bytes>=0),
 PRIMARY KEY(organization_id,period_id),
 CHECK((allowance->>'organizationId'=organization_id::text AND allowance->>'periodId'=period_id) IS TRUE)
);
CREATE TABLE send_usage_reservations (
 organization_id UUID NOT NULL, period_id TEXT NOT NULL, reservation_id TEXT NOT NULL,
 transfer_id UUID NOT NULL, object_name TEXT NOT NULL UNIQUE, payload JSONB NOT NULL,
 PRIMARY KEY(organization_id,period_id,reservation_id), UNIQUE(organization_id,transfer_id),
 FOREIGN KEY(organization_id,period_id) REFERENCES send_usage_periods(organization_id,period_id),
 FOREIGN KEY(organization_id,transfer_id) REFERENCES transfers(organization_id,id),
 CHECK((payload->>'organizationId'=organization_id::text AND payload->>'periodId'=period_id AND payload->>'id'=reservation_id) IS TRUE)
);
CREATE TABLE send_usage_events (
 organization_id UUID NOT NULL, period_id TEXT NOT NULL, event_id TEXT NOT NULL, payload JSONB NOT NULL,
 PRIMARY KEY(organization_id,period_id,event_id),
 FOREIGN KEY(organization_id,period_id) REFERENCES send_usage_periods(organization_id,period_id),
 CHECK((payload->>'id'=event_id) IS TRUE)
);
CREATE INDEX send_usage_reservation_deletion_due ON send_usage_reservations(((payload->>'accessExpiresAt')::BIGINT))
 WHERE payload->>'state'='committed';
CREATE TABLE send_usage_outbox (
 organization_id UUID NOT NULL, period_id TEXT NOT NULL, notice_id TEXT NOT NULL, payload JSONB NOT NULL,
 PRIMARY KEY(organization_id,period_id,notice_id),
 FOREIGN KEY(organization_id,period_id) REFERENCES send_usage_periods(organization_id,period_id),
 CHECK((payload->>'state' IN ('pending','sending','sent','failed','superseded') AND payload->>'id'=notice_id) IS TRUE)
);
CREATE INDEX send_usage_outbox_due ON send_usage_outbox(((payload->>'nextAttemptAt')::BIGINT))
 WHERE payload->>'state' IN ('pending','sending');
CREATE TABLE send_download_observations (
 organization_id UUID NOT NULL, period_id TEXT NOT NULL, observation_id TEXT NOT NULL,
 window_key TEXT NOT NULL, bytes BIGINT NOT NULL CHECK(bytes>=0), payload JSONB NOT NULL,
 PRIMARY KEY(organization_id,period_id,observation_id),
 FOREIGN KEY(organization_id,period_id) REFERENCES send_usage_periods(organization_id,period_id),
 CHECK((payload->>'organizationId'=organization_id::text AND payload->>'periodId'=period_id AND payload->>'id'=observation_id) IS TRUE)
);
CREATE INDEX send_download_observation_window ON send_download_observations(organization_id,period_id,window_key);
CREATE FUNCTION send_usage_history_is_append_only() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Send usage history is append-only'; END;
$$;
CREATE TRIGGER send_usage_events_append_only BEFORE UPDATE OR DELETE ON send_usage_events
 FOR EACH ROW EXECUTE FUNCTION send_usage_history_is_append_only();
CREATE TRIGGER send_download_observations_append_only BEFORE UPDATE OR DELETE ON send_download_observations
 FOR EACH ROW EXECUTE FUNCTION send_usage_history_is_append_only();
-- Before application replace the role placeholder with the reviewed environment-specific runtime role.
-- Explicitly REVOKE UPDATE, DELETE on send_usage_events and send_download_observations, then verify effective ACL.
-- Use approved numbered migration + ledger after rehearsal. Do not edit/re-run historical migrations.
