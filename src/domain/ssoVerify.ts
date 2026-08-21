export type SsoProvider = 'google' | 'microsoft';

export interface SsoVerifyCustomer {
  id: string;
  domain: string;
  companyName: string;
  seatCap: number;
  createdAt: Date;
}

export interface SsoVerifyUser {
  id: string;
  customerId: string;
  email: string;
  provider: SsoProvider;
  firstLoginAt: Date;
  lastLoginAt: Date;
}

/** JITプロビジョニングの結果。スパイク用の簡易ステータス(本番のプラン設計そのものではない)。 */
export type ProvisioningResult =
  | { status: 'provisioned'; companyName: string }
  | { status: 'over_cap'; companyName: string; seatCap: number }
  | { status: 'domain_not_registered' };
