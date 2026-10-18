import type { TenantContext } from '../domain/tenantAuthorization';
import { assertMembership } from '../domain/tenantAuthorization';
import type { UsageSqlPool } from './pgCommercialUsageStore';

export interface VerifiedIdentity { issuer: string; subject: string; email: string; }
export interface SendPrincipal extends TenantContext { email: string; }

/** Identity is resolved only after OIDC signature/audience/issuer/nonce verification.
 * Organization selection is a selector, never a grant. No email/domain auto-join. */
export class CommercialIdentityRepository {
  constructor(private readonly pool: UsageSqlPool) {}
  async resolve(identity: VerifiedIdentity, organizationId?: string): Promise<SendPrincipal> {
    if (!identity.issuer || !identity.subject) throw new Error('IDENTITY_REQUIRED');
    const c = await this.pool.connect();
    try {
      const { rows } = await c.query(`SELECT o.id AS organization_id,o.status AS organization_status,
        u.id AS user_id,u.status AS user_status,m.role,m.status AS membership_status,m.can_send,i.email
        FROM user_identities i JOIN users u ON u.id=i.user_id
        JOIN memberships m ON m.user_id=u.id JOIN organizations o ON o.id=m.organization_id
        WHERE i.issuer=$1 AND i.subject=$2 AND ($3::uuid IS NULL OR o.id=$3::uuid)
          AND o.status='active' AND u.status='active' AND m.status='active'`,
      [identity.issuer, identity.subject, organizationId ?? null]);
      if (rows.length !== 1) throw new Error('MEMBERSHIP_SELECTION_REQUIRED_OR_DENIED');
      const r = rows[0]!;
      const result: SendPrincipal = {
        organization: { id: String(r.organization_id), status: r.organization_status as 'active' },
        user: { id: String(r.user_id), status: r.user_status as 'active' },
        membership: { organizationId: String(r.organization_id), userId: String(r.user_id),
          role: r.role as 'admin' | 'member', status: r.membership_status as 'active', canSend: r.can_send === true },
        email: String(r.email),
      };
      assertMembership(result); return result;
    } finally { c.release(); }
  }
}
