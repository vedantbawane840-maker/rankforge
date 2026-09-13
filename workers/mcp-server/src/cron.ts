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

    // 1. Paginate through all user documents in Firestore
    let pageToken: string | undefined = undefined;
    const allUserDocNames: string[] = [];

    do {
      const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const listUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users?pageSize=300${pageParam}`;
      const listRes = await fetch(listUrl);

      if (!listRes.ok) {
        console.error(`[RankForge Cron] Failed to list users: ${listRes.status}`);
        break;
      }

      const listData = (await listRes.json()) as {
        documents?: Array<{ name: string }>;
        nextPageToken?: string;
      };

      if (listData.documents) {
        for (const doc of listData.documents) {
          allUserDocNames.push(doc.name);
        }
      }

      pageToken = listData.nextPageToken;
    } while (pageToken);

    console.log(`[RankForge Cron] Found ${allUserDocNames.length} total users to reset across all pages.`);

    // 2. Batch commit updates in chunks of 250 (Firestore limit is 500 writes/commit)
    let resetCount = 0;
    const chunkSize = 250;
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;

    for (let i = 0; i < allUserDocNames.length; i += chunkSize) {
      const chunk = allUserDocNames.slice(i, i + chunkSize);
      const writes = chunk.map(docName => ({
        update: {
          name: docName,
          fields: {
            audits_used: { integerValue: '0' },
            reset_date: { timestampValue: nextResetIso },
            updated_at: { timestampValue: new Date().toISOString() }
          }
        },
        updateMask: {
          fieldPaths: ['audits_used', 'reset_date', 'updated_at']
        }
      }));

      try {
        const commitRes = await fetch(commitUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ writes })
        });

        if (commitRes.ok) {
          resetCount += chunk.length;
        } else {
          console.error(`[RankForge Cron] Batch commit chunk failed: ${commitRes.status}`);
        }
      } catch (chunkErr) {
        console.error('[RankForge Cron] Error during batch commit:', chunkErr);
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
