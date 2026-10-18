-- REVIEW ONLY / UNNUMBERED / UNAPPLIED. Run after tenant-foundation, before commercial-usage.
-- Additive: legacy rows stay unassigned (NULL), never guess ownership by email/domain.
ALTER TABLE transfer_groups
  ADD COLUMN organization_id UUID REFERENCES organizations(id),
  ADD COLUMN sender_user_id UUID REFERENCES users(id),
  ADD CONSTRAINT send_group_scope_pair CHECK ((organization_id IS NULL)=(sender_user_id IS NULL)),
  ADD CONSTRAINT send_group_org_id UNIQUE(organization_id,id),
  ADD CONSTRAINT send_group_owner UNIQUE(organization_id,id,sender_user_id),
  ADD CONSTRAINT send_group_membership FOREIGN KEY(organization_id,sender_user_id)
    REFERENCES memberships(organization_id,user_id);

ALTER TABLE transfers
  ADD COLUMN organization_id UUID REFERENCES organizations(id),
  ADD COLUMN sender_user_id UUID REFERENCES users(id),
  ADD COLUMN storage_generation TEXT CHECK(storage_generation ~ '^[0-9]+$'),
  ADD CONSTRAINT send_transfer_scope_pair CHECK ((organization_id IS NULL)=(sender_user_id IS NULL)),
  ADD CONSTRAINT send_transfer_org_id UNIQUE(organization_id,id),
  ADD CONSTRAINT send_transfer_group_owner FOREIGN KEY(organization_id,group_id,sender_user_id)
    REFERENCES transfer_groups(organization_id,id,sender_user_id),
  ADD CONSTRAINT send_transfer_group_required CHECK(organization_id IS NULL OR group_id IS NOT NULL);

CREATE INDEX send_group_owner_history ON transfer_groups(organization_id,sender_user_id,created_at DESC);
CREATE INDEX send_transfer_owner_history ON transfers(organization_id,sender_user_id,created_at DESC);

-- All Send membership, identity, organization, group revoke/retention and transfer writers must
-- acquire send-usage:<org> advisory locks first (sorted org IDs), then organization/child row locks.
-- Existing tenant draft row-lock-only guidance is superseded for this connected path.
-- No customer membership CRUD or global user-reactivation writer is enabled by this patch.
