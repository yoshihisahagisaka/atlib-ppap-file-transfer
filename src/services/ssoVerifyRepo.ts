import type { Pool } from 'pg';
import type { SsoProvider, SsoVerifyCustomer, SsoVerifyUser } from '../domain/ssoVerify';

interface CustomerRow {
  id: string;
  domain: string;
  company_name: string;
  seat_cap: number;
  created_at: Date;
}

interface UserRow {
  id: string;
  customer_id: string;
  email: string;
  provider: SsoProvider;
  first_login_at: Date;
  last_login_at: Date;
}

function toCustomer(row: CustomerRow): SsoVerifyCustomer {
  return {
    id: row.id,
    domain: row.domain,
    companyName: row.company_name,
    seatCap: row.seat_cap,
    createdAt: row.created_at,
  };
}

function toUser(row: UserRow): SsoVerifyUser {
  return {
    id: row.id,
    customerId: row.customer_id,
    email: row.email,
    provider: row.provider,
    firstLoginAt: row.first_login_at,
    lastLoginAt: row.last_login_at,
  };
}

/** SSO検証スパイク専用のリポジトリ(sso_verify_customers / sso_verify_users)。本番テーブルには一切触れない。 */
export class SsoVerifyRepo {
  constructor(private readonly pool: Pool) {}

  async findCustomerByDomain(domain: string): Promise<SsoVerifyCustomer | null> {
    const { rows } = await this.pool.query<CustomerRow>(
      'SELECT * FROM sso_verify_customers WHERE domain = $1',
      [domain],
    );
    const row = rows[0];
    return row ? toCustomer(row) : null;
  }

  async findUserByEmail(email: string): Promise<SsoVerifyUser | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM sso_verify_users WHERE email = $1', [email]);
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async countUsersForCustomer(customerId: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM sso_verify_users WHERE customer_id = $1',
      [customerId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async createUser(input: { customerId: string; email: string; provider: SsoProvider }): Promise<SsoVerifyUser> {
    const { rows } = await this.pool.query<UserRow>(
      `INSERT INTO sso_verify_users (customer_id, email, provider)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.customerId, input.email, input.provider],
    );
    const row = rows[0];
    if (!row) throw new Error('Failed to create sso_verify_users row');
    return toUser(row);
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.pool.query('UPDATE sso_verify_users SET last_login_at = now() WHERE id = $1', [userId]);
  }
}
