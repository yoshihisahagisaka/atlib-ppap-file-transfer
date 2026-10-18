-- NEW dedicated Secure Send cluster bootstrap ONLY. No application migrations.
CREATE ROLE send_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE send_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE send_readonly LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE DATABASE :"send_db" OWNER send_migrator TEMPLATE template0 ENCODING 'UTF8';
REVOKE ALL ON DATABASE :"send_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"send_db" TO send_runtime,send_readonly;
\connect :send_db
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE,CREATE ON SCHEMA public TO send_migrator;
GRANT USAGE ON SCHEMA public TO send_runtime,send_readonly;
ALTER ROLE send_readonly SET default_transaction_read_only=on;
ALTER ROLE send_readonly SET statement_timeout='10s';
ALTER ROLE send_runtime SET statement_timeout='60s';
ALTER DEFAULT PRIVILEGES FOR ROLE send_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE send_migrator IN SCHEMA public GRANT SELECT ON TABLES TO send_readonly;
-- Set dedicated passwords interactively with psql \password before remote login.
-- No application tables/ledger, runtime CRUD grants, or migration execution.
