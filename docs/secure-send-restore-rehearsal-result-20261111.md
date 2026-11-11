# Secure Send validation DB restore rehearsal result

Date: 2026-11-11 JST  
Scope: approved recovery option A only. No migration, fixture, Production, shared DB, existing internal Secure Send, main merge, or commercial release.

## 1. Target and environment

- Canonical PR: #11, commit `fa36d1bae2a5e0ba4aeec5b1a5f85aa7a8ccec88`.
- Source: `secure-send-pg17-validation`, volume `secure-send-pg17-validation-data`, `127.0.0.1:55432`, DB `send_commercial_usage_test`.
- Restore: `secure-send-pg17-restore`, volume `secure-send-pg17-restore-data`, `127.0.0.1:55433`, DB `send_restore_commercial_usage_test`.
- Both clusters used the pinned `postgres:17` image digest `sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675` and reported PostgreSQL 17.11.
- Source and restore containers were stopped normally after verification. Both volumes remain present.

## 2. Phase 1 preflight

| Check | Result | Evidence summary |
|---|---|---|
| PR #11 / approval A / canonical commit | PASS | PR head and approval comment matched the supplied canonical. |
| Clean dedicated worktree | PASS | Detached clean checkout at `fa36d1b`; no pre-existing worktree was overwritten. |
| Docker identity and isolation | PASS | Dedicated names, dedicated volumes, loopback-only ports 55432/55433; no other container or volume was operated. |
| Source DB identity | PASS | `send_commercial_usage_test`, owner `send_migrator`, PostgreSQL 17.11. |
| Source roles | PASS | `send_migrator`, `send_runtime`, and `send_readonly` are LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOREPLICATION, NOBYPASSRLS. No role memberships. |
| Source DB/schema ACL | PASS | PUBLIC has no DB privileges; runtime/readonly have CONNECT; public schema owner is `pg_database_owner` with the approved explicit ACL. |
| Source schema/ledger/data state | PASS | No public application objects; `public.schema_migrations` absent; no application/worker connections. |
| Disk gate | PASS | C: free space was about 25.7 GiB before backup and remained above 25 GiB. |
| Manifest | PASS | Eight raw Git sources matched approved SHA-256, byte counts, and Git blobs. Remote main still contains 001/002/003/004/006; archive 005 remains excluded; no 007-010 collision. |

The source container had previously exited with 255 after an unclean Docker interruption. PostgreSQL performed automatic crash recovery and reached ready state without manual repair, reinitialization, or privilege change.

## 3. Backup

- Format: PostgreSQL custom archive (`-Fc`).
- Private Git-excluded file: `send-before-20261111-143416.dump` under the approved private root.
- Bytes: `2190`.
- SHA-256: `63ED2AB600201DC60659C608127357D8AD8D144F03438E13699796769A221216`.
- `pg_restore --list`: PASS; PostgreSQL 17.11 archive, 8 TOC entries, schema ACL and two default ACL entries present.
- No password hash, customer value, or secret was recorded.

## 4. Restore rehearsal

| Check | Result | Evidence summary |
|---|---|---|
| Independent empty destination | PASS | New dedicated container/volume on loopback 55433; public object count 0 and ledger absent before restore. |
| Bootstrap roles and owner | PASS | Same four role attributes; restore DB owner `send_migrator`. Dedicated restore secret was generated outside Git. |
| Transfer integrity | PASS | Host and in-container dump SHA-256 matched exactly. |
| Restore execution | PASS | `pg_restore --exit-on-error --single-transaction` exited 0; owner and privileges were not suppressed. |
| DB owner and DB ACL | PASS | Owner and normalized CONNECT/CREATE/TEMP privileges matched source. |
| Schema owner and ACL | PASS | Exact source/restore match. |
| Role attributes/configuration | PASS | Exact source/restore match, including readonly and runtime timeout settings. |
| Default ACL | PASS | Exact source/restore match for migrator functions and readonly table SELECT. |
| Ledger and record counts | PASS | Ledger absent in both; zero public application objects/records in both. |
| Source impact | PASS | Source identity and metadata remained unchanged; source and restore stopped with exit 0; both volumes retained. |

One initial restore-resource creation attempt stopped before creating any resource because the Runbook's static RNG API was unavailable in the installed PowerShell/.NET. The retry used the equivalent `RandomNumberGenerator.Create().GetBytes(...)` API. No cleanup, reinitialization, privilege expansion, or timeout extension was performed.

## 5. Migration pre-application gate

| Gate | Result | Evidence summary |
|---|---|---|
| Target identity / empty DB / empty ledger | PASS | Reconfirmed immediately before backup; migration remains unexecuted. |
| SQL originals and order | PASS | Offline bundle contains only 001, 002, 003, 004, 006, 007, 008, 009, 010 plus wrapper; archive 005 excluded. |
| SQL hashes | PASS | All nine generated SQL files match the approved manifest, including ACL SHA-256 `4F7819AB2AC94856BEA7B1FB9C0B85A2EEFA3ECAD764B9545C3812889AD6F088`. |
| Role / ACL | PASS | Current source state matches Canonical. |
| Backup integrity | PASS | Hash, bytes, and archive list verified before and after transfer. |
| Restore rehearsal | PASS | All required restore comparisons passed. |
| Disk | PASS | More than 25 GiB free after the rehearsal. |
| Timeouts | PASS | Generated wrapper fixes `lock_timeout='5s'` and `statement_timeout='60s'` per file. |
| Migration execution | SKIP | Explicit No-Go for this approval scope. No SQL bundle was transferred to the source container and no migration was applied. |

## 6. Overall result and decision material

- Phase 1: PASS.
- Phase 2: PASS.
- Phase 3 / recovery option A: PASS.
- Migration pre-application preparation: PASS.
- Migration execution and post-migration tests: SKIP (not authorized).
- Fixture, external services, Production, shared DB, internal Secure Send, main merge, and commercial release: SKIP / unchanged.
- New STOP gap: none found.

Go/No-Go: **Go material is complete for a separate migration-application decision; current execution status remains No-Go until explicit approval.**
