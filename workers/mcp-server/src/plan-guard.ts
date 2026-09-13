import { WorkerEnv } from './auth';

export interface UserPlanData {
  uid: string;
  plan: 'free' | 'pro' | 'agency' | 'enterprise';
  audits_used: number;
  audits_limit: number;
  projects_used: number;
  projects_limit: number;
  reset_date: string;
  apify_key?: string;
  apify_key_encrypted?: string;
}

const DEFAULT_PLANS = {
  free: { audits_limit: 10, projects_limit: 1 },
  pro: { audits_limit: 100, projects_limit: 5 },
  agency: { audits_limit: 500, projects_limit: 25 },
  enterprise: { audits_limit: 999999, projects_limit: 999999 }
};

/**
 * Checks and enforces user plan limits from Firestore (with D1 edge counter support).
 */
export interface PlanGuardResult {
  allowed: boolean;
  remaining: number;
  plan: string;
  user: UserPlanData;
}

/**
 * Complete plan limit enforcement:
 * 1. Get user from Firestore by uid
 * 2. Check if plan is active (not cancelled/expired)
 * 3. Check audits_used < audits_limit
 * 4. Check projects_used < projects_limit
 * 5. If any check fails -> throw structured error with upgrade link
 * 6. If all pass -> increment audits_used atomically
 * 7. Return { allowed: true, remaining: number, plan: string }
 */
export async function enforcePlanLimits(
  uid: string,
  env: WorkerEnv,
  isNewProjectCheck: boolean = false
): Promise<PlanGuardResult> {
  // 1. Get user from Firestore
  const planData = await getUserPlanData(uid, env);

  // Check monthly reset cycle
  const resetTime = new Date(planData.reset_date).getTime();
  const now = Date.now();
  if (now > resetTime) {
    planData.audits_used = 0;
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    planData.reset_date = nextMonth.toISOString();
    await updateUserPlanData(uid, { audits_used: 0, reset_date: planData.reset_date }, env);
  }

  // 2. Check if plan is active (not cancelled/expired)
  if ((planData as any).status === 'cancelled' || (planData as any).status === 'expired') {
    throw new Error('Subscription is inactive or cancelled. Upgrade at rankforge.app/pricing');
  }

  // 3. Check audits_used < audits_limit
  if (planData.audits_used >= planData.audits_limit) {
    throw new Error('Monthly audit limit reached. Upgrade at rankforge.app/pricing');
  }

  // 4. Check projects_used < projects_limit (for new project creation)
  if (isNewProjectCheck && planData.projects_used >= planData.projects_limit) {
    throw new Error('Project limit reached for your plan. Upgrade at rankforge.app/pricing');
  }

  // 6. Increment audits_used atomically
  await recordAuditUsage(uid, planData.audits_used, env);
  planData.audits_used += 1;

  // 7. Return structured allowed result
  const remaining = Math.max(0, planData.audits_limit - planData.audits_used);
  return {
    allowed: true,
    remaining,
    plan: planData.plan,
    user: planData
  };
}

/**
 * Increments the user's audit usage counter in Firestore and D1 if available.
 * Uses atomic field transforms in Firestore and ON CONFLICT upsert in D1
 * to eliminate race conditions under concurrent requests.
 */
export async function recordAuditUsage(
  uid: string,
  currentUsed: number,
  env: WorkerEnv
): Promise<void> {
  // 1. Fast Edge record in D1 if available (atomic SQL upsert)
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO user_audits (uid, count, last_used)
         VALUES (?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(uid) DO UPDATE SET count = count + 1, last_used = CURRENT_TIMESTAMP`
      )
        .bind(uid)
        .run();
    } catch {
      // D1 non-blocking failover
    }
  }

  // 2. Persistent atomic transform in Firestore
  if (env.FIREBASE_PROJECT_ID) {
    try {
      const commitUrl = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
      await fetch(commitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          writes: [
            {
              transform: {
                document: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`,
                fieldTransforms: [
                  {
                    fieldPath: 'audits_used',
                    increment: { integerValue: '1' }
                  },
                  {
                    fieldPath: 'updated_at',
                    setToServerValue: 'REQUEST_TIME'
                  }
                ]
              }
            }
          ]
        })
      });
    } catch {
      // Non-blocking log/ignore
    }
  }
}

/**
 * Retrieves the user record from Firestore REST API.
 */
export async function getUserPlanData(
  uid: string,
  env: WorkerEnv
): Promise<UserPlanData> {
  const fallbackDate = new Date();
  fallbackDate.setMonth(fallbackDate.getMonth() + 1);

  if (!env.FIREBASE_PROJECT_ID) {
    // Sandbox / Dev environment fallback
    return {
      uid,
      plan: 'pro',
      audits_used: 0,
      audits_limit: 100,
      projects_used: 1,
      projects_limit: 10,
      reset_date: fallbackDate.toISOString()
    };
  }

  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;

  try {
    const res = await fetch(firestoreUrl);
    if (!res.ok) {
      if (res.status === 404) {
        // First-time user auto-provision on Free Scout tier
        const initialPlan: UserPlanData = {
          uid,
          plan: 'free',
          audits_used: 0,
          audits_limit: DEFAULT_PLANS.free.audits_limit,
          projects_used: 0,
          projects_limit: DEFAULT_PLANS.free.projects_limit,
          reset_date: fallbackDate.toISOString()
        };
        await createFirestoreUser(uid, initialPlan, env);
        return initialPlan;
      }
      throw new Error(`Firestore read failed with status ${res.status}`);
    }

    const doc = (await res.json()) as {
      fields?: Record<string, { stringValue?: string; integerValue?: string; timestampValue?: string }>;
    };

    const fields = doc.fields || {};
    const plan = (fields.plan?.stringValue as 'free' | 'pro' | 'agency' | 'enterprise') || 'free';
    const limits = DEFAULT_PLANS[plan] || DEFAULT_PLANS.free;

    const audits_limit = fields.audits_limit?.integerValue
      ? parseInt(fields.audits_limit.integerValue, 10)
      : limits.audits_limit;

    const audits_used = fields.audits_used?.integerValue
      ? parseInt(fields.audits_used.integerValue, 10)
      : 0;

    const projects_limit = fields.projects_limit?.integerValue
      ? parseInt(fields.projects_limit.integerValue, 10)
      : limits.projects_limit;

    const projects_used = fields.projects_used?.integerValue
      ? parseInt(fields.projects_used.integerValue, 10)
      : 0;

    const reset_date = fields.reset_date?.timestampValue || fallbackDate.toISOString();
    const apify_key = fields.apify_key_encrypted?.stringValue || fields.apify_key?.stringValue;

    return {
      uid,
      plan,
      audits_used,
      audits_limit,
      projects_used,
      projects_limit,
      reset_date,
      apify_key,
      apify_key_encrypted: fields.apify_key_encrypted?.stringValue
    };
  } catch {
    // Return safe fallback for resilience
    return {
      uid,
      plan: 'free',
      audits_used: 0,
      audits_limit: DEFAULT_PLANS.free.audits_limit,
      projects_used: 0,
      projects_limit: DEFAULT_PLANS.free.projects_limit,
      reset_date: fallbackDate.toISOString()
    };
  }
}

/**
 * Updates partial user plan fields in Firestore.
 */
async function updateUserPlanData(
  uid: string,
  updates: Partial<{ audits_used: number; reset_date: string; plan: string }>,
  env: WorkerEnv
): Promise<void> {
  if (!env.FIREBASE_PROJECT_ID) return;

  const fields: Record<string, unknown> = {};
  const updateMaskParts: string[] = [];

  if (updates.audits_used !== undefined) {
    fields.audits_used = { integerValue: updates.audits_used.toString() };
    updateMaskParts.push('updateMask.fieldPaths=audits_used');
  }
  if (updates.reset_date !== undefined) {
    fields.reset_date = { timestampValue: updates.reset_date };
    updateMaskParts.push('updateMask.fieldPaths=reset_date');
  }
  if (updates.plan !== undefined) {
    fields.plan = { stringValue: updates.plan };
    updateMaskParts.push('updateMask.fieldPaths=plan');
  }

  const queryParams = updateMaskParts.join('&');
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}?${queryParams}`;

  await fetch(firestoreUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
}

/**
 * Provisions a fresh user document in Firestore.
 */
async function createFirestoreUser(
  uid: string,
  data: UserPlanData,
  env: WorkerEnv
): Promise<void> {
  if (!env.FIREBASE_PROJECT_ID) return;

  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;
  const fields = {
    plan: { stringValue: data.plan },
    audits_used: { integerValue: data.audits_used.toString() },
    audits_limit: { integerValue: data.audits_limit.toString() },
    projects_used: { integerValue: data.projects_used.toString() },
    projects_limit: { integerValue: data.projects_limit.toString() },
    reset_date: { timestampValue: data.reset_date },
    created_at: { timestampValue: new Date().toISOString() }
  };

  await fetch(firestoreUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
}

/**
 * Decrypts user's AES-256 encrypted Apify token.
 * Never logs or returns the token in errors or logs.
 */
export async function getDecryptedApifyKey(
  encryptedPayload: string | undefined,
  encryptionSecret: string | undefined
): Promise<string | null> {
  if (!encryptedPayload) return null;

  // Plain token check for development / direct mode
  if (encryptedPayload.startsWith('apify_api_')) {
    return encryptedPayload;
  }

  if (!encryptionSecret) {
    return null;
  }

  try {
    // Derive 256-bit key from secret using SHA-256
    const enc = new TextEncoder();
    const keyHash = await crypto.subtle.digest('SHA-256', enc.encode(encryptionSecret));
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyHash,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Format: ivHex:cipherHex
    const parts = encryptedPayload.split(':');
    if (parts.length !== 2) {
      return null;
    }

    const ivBytes = hexToUint8Array(parts[0]);
    const cipherBytes = hexToUint8Array(parts[1]);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      cryptoKey,
      cipherBytes
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch {
    return null;
  }
}

/**
 * Encrypts an Apify API key using AES-256-GCM.
 */
export async function encryptApifyKey(
  plainText: string,
  encryptionSecret: string
): Promise<string> {
  const enc = new TextEncoder();
  const keyHash = await crypto.subtle.digest('SHA-256', enc.encode(encryptionSecret));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyHash,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    enc.encode(plainText)
  );

  const ivHex = uint8ArrayToHex(iv);
  const cipherHex = uint8ArrayToHex(new Uint8Array(encryptedBuffer));
  return `${ivHex}:${cipherHex}`;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
