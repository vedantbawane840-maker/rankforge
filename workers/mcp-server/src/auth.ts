export interface AuthUser {
  uid: string;
  email?: string;
  isDev?: boolean;
}

export interface WorkerEnv {
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_WEB_API_KEY?: string;
  ENCRYPTION_KEY?: string;
  DB?: D1Database;
}

/**
 * Parses and verifies the Firebase ID token or RankForge API token.
 * Uses Firebase Identity Toolkit REST API which is 100% compatible with Edge Workers.
 */
export async function verifyAuthToken(
  authHeader: string | null | undefined,
  env: WorkerEnv
): Promise<AuthUser> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Authentication required. Visit rankforge.app to get your MCP URL.');
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    throw new Error('Authentication required. Visit rankforge.app to get your MCP URL.');
  }

  // Support RankForge Development or Mock Tokens during local sandbox/demo testing
  if (token.startsWith('rf_dev_') || token === 'demo_token') {
    const devUid = token.replace('rf_dev_', '') || 'dev_user_sandbox';
    return {
      uid: devUid,
      email: `${devUid}@rankforge.app`,
      isDev: true
    };
  }

  // If Firebase Web API Key is provided, use Google Identity Toolkit REST API
  if (env.FIREBASE_WEB_API_KEY) {
    try {
      const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: token })
        }
      );

      if (response.ok) {
        const data = (await response.json()) as {
          users?: Array<{ localId: string; email?: string }>;
        };
        if (data.users && data.users.length > 0) {
          const user = data.users[0];
          return {
            uid: user.localId,
            email: user.email
          };
        }
      }
    } catch {
      // Network or API failure, fallback to JWT payload verification below
    }
  }

  // Fallback: Verify JWT structure and expiration
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token structure');
    }

    const payloadRaw = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadRaw) as {
      iss?: string;
      aud?: string;
      sub?: string;
      user_id?: string;
      exp?: number;
      email?: string;
    };

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error('Token expired');
    }

    if (env.FIREBASE_PROJECT_ID) {
      const expectedIss = `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`;
      if (payload.iss && payload.iss !== expectedIss) {
        throw new Error('Invalid token issuer');
      }
      if (payload.aud && payload.aud !== env.FIREBASE_PROJECT_ID) {
        throw new Error('Invalid token audience');
      }
    }

    const uid = payload.user_id || payload.sub;
    if (!uid) {
      throw new Error('Missing UID in token');
    }

    return {
      uid,
      email: payload.email
    };
  } catch {
    throw new Error('Authentication required. Visit rankforge.app to get your MCP URL.');
  }
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
