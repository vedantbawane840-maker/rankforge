import { WorkerEnv } from './auth';

/**
 * Cloudflare Worker Scheduled Cron Handler: "0 0 1 * *" (First of every month)
 * Iterates through all users in Firestore and resets audits_used to 0
 * while setting reset_date to the first day of the subsequent month.
 */
export async function handleMonthlyReset(
  _event: ScheduledEvent,
  env: WorkerEnv,
  _ctx: ExecutionContext
): Promise<void> {
  console.log('[RankForge Cron] Starting monthly audit reset...');

  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.log('[RankForge Cron] FIREBASE_PROJECT_ID not set, skipping remote reset.');
    return;
  }

  try {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    nextMonth.setHours(0, 0, 0, 0);
    const nextResetIso = nextMonth.toISOString();

    // 1. Fetch user documents from Firestore REST API
    const listUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users?pageSize=300`;
    const listRes = await fetch(listUrl);

    if (!listRes.ok) {
      console.error(`[RankForge Cron] Failed to list users: ${listRes.status}`);
      return;
    }

    const listData = (await listRes.json()) as {
      documents?: Array<{
        name: string; // projects/.../databases/(default)/documents/users/{uid}
        fields?: Record<string, unknown>;
      }>;
    };

    const docs = listData.documents || [];
    console.log(`[RankForge Cron] Found ${docs.length} users to evaluate for reset.`);

    // 2. Reset audits_used for each user
    let resetCount = 0;
    for (const doc of docs) {
      const docName = doc.name; // Full document path
      const patchUrl = `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=audits_used&updateMask.fieldPaths=reset_date&updateMask.fieldPaths=updated_at`;

      const patchBody = {
        fields: {
          audits_used: { integerValue: '0' },
          reset_date: { timestampValue: nextResetIso },
          updated_at: { timestampValue: new Date().toISOString() }
        }
      };

      try {
        const patchRes = await fetch(patchUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody)
        });

        if (patchRes.ok) {
          resetCount++;
        }
      } catch (patchErr) {
        console.error(`[RankForge Cron] Error resetting user ${docName}:`, patchErr);
      }
    }

    // 3. Clear or reset edge counters in D1 if available
    if (env.DB) {
      try {
        await env.DB.prepare('UPDATE user_audits SET count = 0, last_used = CURRENT_TIMESTAMP').run();
      } catch {
        // Non-blocking D1 error
      }
    }

    console.log(`[RankForge Cron] Monthly reset complete. ${resetCount} users reset to 0 audits.`);
  } catch (err) {
    console.error('[RankForge Cron] Unexpected failure during monthly reset:', err);
  }
}
