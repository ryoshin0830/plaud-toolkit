import { PlaudConfig } from './config.js';
import { resolveBaseUrl, PLAUD_USER_AGENT } from './types.js';
import type { PlaudTokenData } from './types.js';

const TOKEN_REFRESH_BUFFER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface PlaudJwtClaims {
  iat: number;
  exp: number;
  region?: string;
}

export function decodePlaudJwt(jwt: string): PlaudJwtClaims {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  return {
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
    region: typeof payload.region === 'string' ? payload.region : undefined,
  };
}

export class PlaudAuth {
  private config: PlaudConfig;

  constructor(config: PlaudConfig) {
    this.config = config;
  }

  async getToken(): Promise<string> {
    const cached = this.config.getToken();
    const creds = this.config.getCredentials();
    const isSso = creds?.authMode === 'sso' || (!!creds && !creds.email && !creds.password);

    if (isSso) {
      if (!cached) {
        throw new Error("No SSO token stored. Run 'plaud login-sso'.");
      }
      if (this.isExpiringSoon(cached)) {
        const days = Math.max(0, Math.ceil((cached.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
        throw new Error(
          `Plaud SSO token expires in ${days} day(s). ` +
          "Re-run 'plaud login-sso' with a fresh value from web.plaud.ai localStorage.tokenstr."
        );
      }
      return cached.accessToken;
    }

    if (cached && !this.isExpiringSoon(cached)) {
      return cached.accessToken;
    }
    return this.login();
  }

  async login(): Promise<string> {
    const creds = this.config.getCredentials();
    if (!creds) {
      throw new Error('No credentials configured. Run `plaud login` first.');
    }
    if (creds.authMode === 'sso' || !creds.email || !creds.password) {
      throw new Error(
        "This config is in SSO mode; cannot refresh via email+password. " +
        "Run 'plaud login-sso' with a fresh web.plaud.ai token."
      );
    }

    const baseUrl = resolveBaseUrl(creds.region);
    const body = new URLSearchParams({
      username: creds.email,
      password: creds.password,
    });

    const res = await fetch(`${baseUrl}/auth/access-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': PLAUD_USER_AGENT,
      },
      body: body.toString(),
    });

    const data = await res.json() as {
      status: number;
      msg?: string;
      access_token: string;
      token_type: string;
    };

    if (data.status !== 0 || !data.access_token) {
      throw new Error(data.msg || `Login failed (status ${data.status})`);
    }

    const decoded = decodePlaudJwt(data.access_token);
    const tokenData: PlaudTokenData = {
      accessToken: data.access_token,
      tokenType: data.token_type || 'Bearer',
      issuedAt: decoded.iat * 1000,
      expiresAt: decoded.exp * 1000,
    };

    this.config.saveToken(tokenData);
    return data.access_token;
  }

  private isExpiringSoon(token: PlaudTokenData): boolean {
    return Date.now() + TOKEN_REFRESH_BUFFER_MS > token.expiresAt;
  }
}
