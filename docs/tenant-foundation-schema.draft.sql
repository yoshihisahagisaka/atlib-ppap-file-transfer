-- REVIEW ONLY. Outside migrations/ so the runner cannot apply it.
-- No production backfill or business-table alteration is included in this draft.
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  email TEXT NOT NULL,
  PRIMARY KEY (issuer, subject)
);

CREATE TABLE memberships (
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'suspended')),
  can_send BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (organization_id, user_id)
);

-- Technical allowance configuration only; no prices, currency or revenue share.
CREATE TABLE plan_versions (
  plan_id TEXT NOT NULL,
  version TEXT NOT NULL,
  sender_limit INTEGER NOT NULL CHECK (sender_limit >= 0),
  PRIMARY KEY (plan_id, version)
);

CREATE TABLE organization_plan_assignments (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id),
  plan_id TEXT NOT NULL,
  version TEXT NOT NULL,
  FOREIGN KEY (plan_id, version) REFERENCES plan_versions(plan_id, version)
);

-- Authoritative current sender-count query (bind $1 to trusted organization ID):
-- SELECT count(*) FROM memberships m JOIN users u ON u.id = m.user_id
-- WHERE m.organization_id = $1 AND m.status = 'active'
--   AND m.can_send = true AND u.status = 'active';
-- All activation/assignment changes must serialize on the organization row
-- with SELECT ... FOR UPDATE in the SAME transaction as count and update.
-- Global user reactivation must lock all affected organizations in ID order.
