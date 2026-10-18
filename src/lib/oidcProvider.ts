import { createRemoteJWKSet, jwtVerify } from 'jose';

interface OidcDiscoveryDocument {
  authorization_endpoint: string;
  token_endpoint: string;
  issuer: string;
  jwks_uri: string;
}

export interface OidcProviderConfig {
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string; // 例: 'openid email profile'
}

/**
 * Google / Microsoft Entra ID共通で使えるAuthorization Code + PKCEクライアント。
 * src/middleware/iapAuth.tsのjose(createRemoteJWKSet + jwtVerify)によるOIDC JWT検証パターンを、
 * 「トークンを検証するだけ」から「認可URL組み立て→コード交換→検証」までのフルフローに拡張したもの。
 * discovery文書を都度取得してエンドポイントをハードコードしないため、Google/Microsoftを
 * 同じクラスで扱える。
 */
export class OidcProvider {
  private discovery: OidcDiscoveryDocument | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly config: OidcProviderConfig) {}

  private async discover(): Promise<{ doc: OidcDiscoveryDocument; jwks: ReturnType<typeof createRemoteJWKSet> }> {
    if (this.discovery && this.jwks) {
      return { doc: this.discovery, jwks: this.jwks };
    }
    const res = await fetch(this.config.discoveryUrl);
    if (!res.ok) {
      throw new Error(`OIDC discovery document fetch failed: ${res.status} ${this.config.discoveryUrl}`);
    }
    const doc = (await res.json()) as OidcDiscoveryDocument;
    this.discovery = doc;
    this.jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
    return { doc, jwks: this.jwks };
  }

  async buildAuthorizationUrl(params: { state: string; nonce: string; codeChallenge: string }): Promise<string> {
    const { doc } = await this.discover();
    const url = new URL(doc.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', this.config.scope);
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<{ idToken: string }> {
    const { doc } = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code_verifier: codeVerifier,
    });
    const res = await fetch(doc.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`OIDC token exchange failed: ${res.status}`);
    }
    const json = (await res.json()) as { id_token?: string };
    if (!json.id_token) throw new Error('OIDC token response is missing id_token');
    return { idToken: json.id_token };
  }

  /**
   * IDトークンを検証し、本人のメールアドレスを返す。emailクレームが無い/未検証の場合は
   * 例外を投げる(このスパイクではMicrosoft Graph /meへのフォールバックは行わない、スコープ外)。
   */
  async verifyIdToken(idToken: string, expectedNonce: string): Promise<{ email: string; issuer: string; subject: string }> {
    const { doc, jwks } = await this.discover();
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: doc.issuer,
      audience: this.config.clientId,
      requiredClaims: ['exp','iat','sub','nonce'],
      maxTokenAge: '10m',
    });

    if (payload.nonce !== expectedNonce) {
      throw new Error('OIDC id_token nonce mismatch');
    }
    if (payload.email_verified === false) {
      throw new Error('Identity provider reports email as unverified');
    }
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    if (!email) {
      throw new Error('OIDC id_token is missing an email claim');
    }
    if (!payload.iss || !payload.sub) throw new Error('OIDC identity missing issuer/subject');
    return { email: email.toLowerCase(), issuer: payload.iss, subject: payload.sub };
  }
}
