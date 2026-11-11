-- Dedicated validation only; apply AFTER all eight approved files, as send_migrator.
-- No blanket default runtime privileges. No application identity/plan/contract management grants.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,send_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC,send_runtime;
GRANT USAGE ON SCHEMA public TO send_runtime,send_readonly;
GRANT SELECT ON organizations,users,user_identities,memberships,plan_versions,organization_plan_assignments TO send_runtime;
-- PostgreSQL row locks need UPDATE on at least one column. Existing FOR SHARE requires these.
GRANT UPDATE(status) ON organizations,users,memberships TO send_runtime;
GRANT SELECT,INSERT ON transfers,transfer_groups,transfer_group_recipients,download_otps,audit_logs TO send_runtime;
GRANT UPDATE(size_bytes,storage_generation,status,uploaded_at,scanned_at) ON transfers TO send_runtime;
GRANT UPDATE(notified_at,download_count,revoked_at) ON transfer_groups TO send_runtime;
GRANT UPDATE(attempt_count,verified_at) ON download_otps TO send_runtime;
GRANT SELECT,INSERT ON send_usage_periods,send_usage_reservations,send_usage_outbox,send_usage_events,send_download_observations TO send_runtime;
GRANT UPDATE(allowance,consumed_bytes,reserved_bytes,extra_bytes) ON send_usage_periods TO send_runtime;
GRANT UPDATE(payload) ON send_usage_reservations,send_usage_outbox TO send_runtime;
REVOKE UPDATE,DELETE,TRUNCATE ON audit_logs,send_usage_events,send_download_observations FROM send_runtime,PUBLIC;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO send_readonly;
-- UUID IDs use no sequences. pgcrypto extension functions are not called by runtime code.
-- Verify effective EXECUTE on the UUID generator selected by column defaults after extension creation.
-- schema_migrations stays migrator-owned; runtime has no SELECT or DML.
