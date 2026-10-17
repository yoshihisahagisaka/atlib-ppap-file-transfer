-- Manual review only. NOT executed during this analysis.
-- Aggregate output only; no filenames, addresses, IDs, tokens, OTPs or JSON detail.
-- July-September are complete months; system started in August per deployment doc.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'Asia/Tokyo';

SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
       count(*) AS groups_created,
       count(*) FILTER (WHERE notified_at IS NOT NULL) AS notification_claims
FROM transfer_groups
WHERE created_at >= '2026-07-01 00:00:00+09' AND created_at < '2026-10-01 00:00:00+09'
GROUP BY 1 ORDER BY 1;
-- notified_at marks notification claim, NOT SMTP delivery success.

SELECT to_char(date_trunc('month', uploaded_at), 'YYYY-MM') AS month,
       count(*) AS completed_upload_files,
       sum(size_bytes) AS declared_upload_bytes,
       avg(size_bytes) AS declared_mean_bytes,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY size_bytes) AS declared_median_bytes,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY size_bytes) AS declared_p95_bytes,
       avg(extract(epoch FROM scanned_at-uploaded_at)) FILTER (WHERE scanned_at IS NOT NULL) AS scan_elapsed_mean_seconds,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM scanned_at-uploaded_at))
         FILTER (WHERE scanned_at IS NOT NULL) AS scan_elapsed_p95_seconds
FROM transfers
WHERE uploaded_at >= '2026-07-01 00:00:00+09' AND uploaded_at < '2026-10-01 00:00:00+09'
GROUP BY 1 ORDER BY 1;
-- size_bytes originates from client declaration; not verified actual network bytes.
-- elapsed includes queue/GCS retrieval/process startup; not pure ClamAV CPU time.

SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
       count(*) FILTER (WHERE event = 'downloaded') AS download_authorizations,
       count(*) FILTER (WHERE event = 'otp_requested') AS recorded_otp_sends,
       count(*) FILTER (WHERE event = 'scan_clean') AS scans_clean,
       count(*) FILTER (WHERE event = 'scan_infected') AS scans_infected
FROM audit_logs
WHERE created_at >= '2026-07-01 00:00:00+09' AND created_at < '2026-10-01 00:00:00+09'
GROUP BY 1 ORDER BY 1;
-- downloaded is signed-URL issuance, not proof of GET completion or bytes.
-- otp_requested follows SMTP call, but cannot prove inbox delivery.
ROLLBACK;
