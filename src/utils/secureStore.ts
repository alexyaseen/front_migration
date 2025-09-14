// TODO: Consider evaluating a more actively maintained alternative to `keytar`
// for secret storage, while retaining OS keychain integration and compatibility
// with both Electron and CLI contexts.
import keytar from 'keytar';

const SERVICE = 'front-to-gmail-migration';

const FRONT_TOKEN_ACCOUNT = 'front-api-token';
const GOOGLE_CREDS_ACCOUNT = 'google-credentials';
const GOOGLE_TOKEN_ACCOUNT = 'google-oauth-token';

export interface GoogleInstalledCredentials {
  installed: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

export interface GoogleToken {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

export class SecureStore {
  async getFrontToken(): Promise<string | null> {
    return (await keytar.getPassword(SERVICE, FRONT_TOKEN_ACCOUNT)) ?? null;
  }

  async setFrontToken(token: string): Promise<void> {
    await keytar.setPassword(SERVICE, FRONT_TOKEN_ACCOUNT, token);
  }
  async deleteFrontToken(): Promise<void> {
    await keytar.deletePassword(SERVICE, FRONT_TOKEN_ACCOUNT);
  }

  async getGoogleCredentials(): Promise<GoogleInstalledCredentials | null> {
    const raw = await keytar.getPassword(SERVICE, GOOGLE_CREDS_ACCOUNT);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.installed?.client_id && parsed?.installed?.client_secret && parsed?.installed?.redirect_uris) {
        return parsed as GoogleInstalledCredentials;
      }
      return null;
    } catch {
      return null;
    }
  }

  async setGoogleCredentials(creds: GoogleInstalledCredentials): Promise<void> {
    await keytar.setPassword(SERVICE, GOOGLE_CREDS_ACCOUNT, JSON.stringify(creds));
  }
  async deleteGoogleCredentials(): Promise<void> {
    await keytar.deletePassword(SERVICE, GOOGLE_CREDS_ACCOUNT);
  }

  async getGoogleToken(): Promise<GoogleToken | null> {
    const raw = await keytar.getPassword(SERVICE, GOOGLE_TOKEN_ACCOUNT);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as GoogleToken;
    } catch {
      return null;
    }
  }

  async setGoogleToken(token: GoogleToken): Promise<void> {
    await keytar.setPassword(SERVICE, GOOGLE_TOKEN_ACCOUNT, JSON.stringify(token));
  }
  async deleteGoogleToken(): Promise<void> {
    await keytar.deletePassword(SERVICE, GOOGLE_TOKEN_ACCOUNT);
  }
}
