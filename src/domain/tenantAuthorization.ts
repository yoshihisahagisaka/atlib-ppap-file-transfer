/** Secure Send only. Authentication must resolve these records server-side. */
export interface Organization {
  id: string;
  status: 'active' | 'suspended';
}

export interface User {
  id: string;
  status: 'active' | 'suspended';
}

export interface Membership {
  organizationId: string;
  userId: string;
  role: 'admin' | 'member';
  status: 'invited' | 'active' | 'suspended';
  canSend: boolean;
}

export interface TenantContext {
  organization: Organization;
  user: User;
  membership: Membership;
}

export class AuthorizationDenied extends Error {
  constructor() { super('Access denied'); }
}

export function assertMembership(context: TenantContext): void {
  const { organization, user, membership } = context;
  if (!organization.id || !user.id || organization.status !== 'active' ||
      user.status !== 'active' || membership.status !== 'active' ||
      membership.organizationId !== organization.id || membership.userId !== user.id) {
    throw new AuthorizationDenied();
  }
}

export function assertSender(context: TenantContext): void {
  assertMembership(context);
  if (context.membership.canSend !== true) throw new AuthorizationDenied();
}

export function assertCustomerAdmin(context: TenantContext): void {
  assertMembership(context);
  if (context.membership.role !== 'admin') throw new AuthorizationDenied();
}

/** A customer administrator does not automatically own members' transfers. */
export function assertOwnedTransfer(
  context: TenantContext,
  transfer: { organizationId: string; senderUserId: string },
): void {
  assertSender(context);
  if (transfer.organizationId !== context.organization.id || transfer.senderUserId !== context.user.id) {
    throw new AuthorizationDenied();
  }
}

/** Counts provisioned active senders; organization suspension does not erase seats. */
export function countActiveSenders(
  organizationId: string,
  users: readonly User[],
  memberships: readonly Membership[],
): number {
  if (!organizationId) throw new Error('Organization is required');
  const activeUsers = new Set(users.filter(user => user.status === 'active').map(user => user.id));
  return new Set(memberships.filter(membership =>
    membership.organizationId === organizationId && membership.status === 'active' &&
    membership.canSend === true && activeUsers.has(membership.userId),
  ).map(membership => membership.userId)).size;
}

/** No prices or default limits. Unconfigured plans cannot authorize activation. */
export interface SenderAllowance {
  planId: string;
  version: string;
  senderLimit: number;
}

export function canActivateSender(activeCount: number, allowance: SenderAllowance | null): boolean {
  return Number.isSafeInteger(activeCount) && activeCount >= 0 && allowance !== null &&
    allowance.planId.length > 0 && allowance.version.length > 0 &&
    Number.isSafeInteger(allowance.senderLimit) && allowance.senderLimit >= 0 &&
    activeCount < allowance.senderLimit;
}
