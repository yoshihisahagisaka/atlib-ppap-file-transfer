import type { SsoVerifyRepo } from './ssoVerifyRepo';
import type { ProvisioningResult, SsoProvider } from '../domain/ssoVerify';

/**
 * ログイン済みメールアドレスのドメインを登録済み顧客と照合し、座席数上限内であれば
 * アカウントを自動発行する(JITプロビジョニング)。プラン設計の「アカウント数上限」が
 * SSO経由でなければ技術的に実効性を持たない、という検討を実際に動かして確かめるためのロジック。
 */
export async function provisionUser(
  repo: SsoVerifyRepo,
  email: string,
  provider: SsoProvider,
): Promise<ProvisioningResult> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) {
    return { status: 'domain_not_registered' };
  }

  const customer = await repo.findCustomerByDomain(domain);
  if (!customer) {
    return { status: 'domain_not_registered' };
  }

  const existing = await repo.findUserByEmail(email);
  if (existing) {
    // 既存ユーザーの再ログインは上限判定の対象外(座席を再消費しない)。
    await repo.touchLastLogin(existing.id);
    return { status: 'provisioned', companyName: customer.companyName };
  }

  const count = await repo.countUsersForCustomer(customer.id);
  if (count >= customer.seatCap) {
    return { status: 'over_cap', companyName: customer.companyName, seatCap: customer.seatCap };
  }

  await repo.createUser({ customerId: customer.id, email, provider });
  return { status: 'provisioned', companyName: customer.companyName };
}
