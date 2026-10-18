const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSender, assertCustomerAdmin, assertOwnedTransfer, countActiveSenders,
  canActivateSender, AuthorizationDenied } = require('../src/domain/tenantAuthorization.ts');

const member = (overrides = {}) => ({ organizationId: 'A', userId: 'u1', role: 'member',
  status: 'active', canSend: true, ...overrides });
const context = () => ({ organization: { id: 'A', status: 'active' },
  user: { id: 'u1', status: 'active' }, membership: member() });

test('own organization and sender succeeds; other organization or owner fails', () => {
  assert.doesNotThrow(() => assertOwnedTransfer(context(), { organizationId: 'A', senderUserId: 'u1' }));
  for (const transfer of [{ organizationId: 'B', senderUserId: 'u1' },
    { organizationId: 'A', senderUserId: 'u2' }]) {
    assert.throws(() => assertOwnedTransfer(context(), transfer), AuthorizationDenied);
  }
});

test('mismatched membership, invitations, suspensions and no-send deny', () => {
  for (const patch of [{ organizationId: 'B' }, { userId: 'u2' }, { status: 'invited' },
    { status: 'suspended' }, { canSend: false }]) {
    assert.throws(() => assertSender({ ...context(), membership: member(patch) }), AuthorizationDenied);
  }
  for (const key of ['organization', 'user']) {
    const ctx = context(); ctx[key].status = 'suspended';
    assert.throws(() => assertSender(ctx), AuthorizationDenied);
  }
});

test('admin does not require a sender seat or bypass tenant ownership', () => {
  const ctx = { ...context(), membership: member({ role: 'admin', canSend: false }) };
  assert.doesNotThrow(() => assertCustomerAdmin(ctx));
  assert.throws(() => assertSender(ctx), AuthorizationDenied);
  assert.throws(() => assertCustomerAdmin(context()), AuthorizationDenied);
  ctx.membership.canSend = true;
  assert.throws(() => assertOwnedTransfer(ctx, { organizationId: 'B', senderUserId: 'u1' }), AuthorizationDenied);
});

test('sender count excludes invited, suspended, other tenants and non-senders; deduplicates', () => {
  const users = ['u1', 'u2', 'u3', 'u4', 'u5'].map(id => ({ id, status: id === 'u5' ? 'suspended' : 'active' }));
  const memberships = [member(), member(), member({ organizationId: 'B' }),
    member({ userId: 'u2', status: 'invited' }), member({ userId: 'u3', status: 'suspended' }),
    member({ userId: 'u4', canSend: false }), member({ userId: 'u5' }), member({ userId: 'missing' })];
  assert.equal(countActiveSenders('A', users, memberships), 1);
  assert.equal(countActiveSenders('B', users, memberships), 1);
  assert.throws(() => countActiveSenders('', users, memberships));
});

test('allowance is configurable and denies unknown, exhausted or invalid configuration', () => {
  const allowance = { planId: 'test-only', version: '1', senderLimit: 2 };
  assert.equal(canActivateSender(1, allowance), true);
  assert.equal(canActivateSender(2, allowance), false);
  assert.equal(canActivateSender(2, { ...allowance, senderLimit: 3 }), true);
  assert.equal(canActivateSender(0, null), false);
  for (const senderLimit of [-1, 1.5, NaN, Infinity]) {
    assert.equal(canActivateSender(0, { ...allowance, senderLimit }), false);
  }
  assert.equal(canActivateSender(-1, allowance), false);
});
