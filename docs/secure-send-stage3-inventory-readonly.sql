-- Supplemental READ ONLY inventory. ONLY verified dedicated local validation DB.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SELECT current_database(),current_user,session_user,current_setting('server_version'),inet_server_addr(),inet_server_port();
SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls
FROM pg_roles WHERE rolname IN(current_user,session_user);
SELECT nspname,pg_get_userbyid(nspowner) AS owner,
 has_schema_privilege(oid,'USAGE') AS usage,has_schema_privilege(oid,'CREATE') AS create_privilege
FROM pg_namespace WHERE nspname='public';
SELECT c.relname,c.relkind,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,
 pg_total_relation_size(c.oid) AS total_bytes,
 has_table_privilege(c.oid,'SELECT') AS can_select,
 has_table_privilege(c.oid,'INSERT') AS can_insert,
 has_table_privilege(c.oid,'UPDATE') AS can_update,
 has_table_privilege(c.oid,'DELETE') AS can_delete
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN('r','p')
ORDER BY c.relname;
SELECT table_name,column_name,data_type,is_nullable,column_default
FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position;
SELECT c.relname,k.conname,k.convalidated,pg_get_constraintdef(k.oid)
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' ORDER BY c.relname,k.conname;
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname;
SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;
SELECT p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner) AS owner,p.prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' ORDER BY p.proname;
SELECT extname,extversion FROM pg_extension ORDER BY extname;
SELECT to_regclass('public.schema_migrations') AS ledger,
 to_regprocedure('gen_random_uuid()') AS uuid_function;
-- Ledger rows are collected by the existing guarded CJS preflight.
ROLLBACK;
