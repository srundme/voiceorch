/**
 * Standalone Google login (sign-in with Google).
 *
 * Reuses the platform-owned OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
 * but requests only basic profile + email scopes — completely separate from the
 * calendar-connection flow, which requests calendar scopes and stores tokens.
 * Login does not need offline access or refresh tokens: we exchange the code,
 * read the profile, and immediately discard the Google tokens.
 */
import { makePlatformOAuth2Client } from "../scheduling/google-calendar.js";

const LOGIN_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export type GoogleProfile = {
  /** Stable Google account id — used as the external auth subject (users.clerk_id). */
  sub: string;
  email: string | null;
  name: string | null;
};

export function getLoginAuthUrl(state: string, redirectUri: string): string {
  const client = makePlatformOAuth2Client(redirectUri);
  return client.generateAuthUrl({
    scope: LOGIN_SCOPES,
    state,
    prompt: "select_account",
  });
}

export async function exchangeLoginCode(code: string, redirectUri: string): Promise<GoogleProfile> {
  const client = makePlatformOAuth2Client(redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error("Missing access_token from Google OAuth response");
  }

  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!res.ok) throw new Error(`Google userinfo error: ${res.status}`);
  const info = (await res.json()) as { id?: string; email?: string; name?: string };
  if (!info.id) throw new Error("No account id (sub) returned from Google");

  return {
    sub: info.id,
    email: info.email ?? null,
    name: info.name ?? null,
  };
}
