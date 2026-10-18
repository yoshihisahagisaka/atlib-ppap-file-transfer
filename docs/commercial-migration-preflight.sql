-- READ ONLY. Run against an explicitly identified validation DB only; do not use the mutation runner.
BEGIN READ ONLY;
SELECT current_database(),current_user,current_setting('server_version');
SELECT to_regclass('public.schema_migrations') AS migration_ledger;
-- Run the following ledger query only if the preceding result exists.
SELECT filename,applied_at FROM schema_migrations ORDER BY filename;
SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name IN
 ('organizations','users','user_identities','memberships','transfer_groups','transfers',
  'send_usage_periods','send_usage_reservations') ORDER BY table_name,ordinal_position;
SELECT count(*) AS groups FROM transfer_groups;
SELECT count(*) AS transfers,count(*) FILTER(WHERE group_id IS NULL) AS ungrouped FROM transfers;
SELECT count(*) AS orphaned_group_refs FROM transfers t LEFT JOIN transfer_groups g ON g.id=t.group_id
 WHERE t.group_id IS NOT NULL AND g.id IS NULL;
ROLLBACK;
