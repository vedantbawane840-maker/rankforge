/**
 * Cloudflare Pages Function: POST /api/webhook/dodo
 * Handles Dodo Payments Webhooks for subscription lifecycle events
 */

const PLAN_LIMITS = {
  free: { audits_limit: 10, projects_limit: 1 },
  pro: { audits_limit: 100, projects_limit: 5 },
  agency: { audits_limit: 500, projects_limit: 25 },
  enterprise: { audits_limit: 999999, projects_limit: 999999 }
};

export async function onRequestPost(context) {
  const rawBody = await context.request.text();
  const signature = context.request.headers.get('webhook-signature') ||
                    context.request.headers.get('x-dodo-signature') ||
                    context.request.headers.get('signature');

  const webhookSecret = context.env?.DODO_WEBHOOK_SECRET;

  // 1. Verify webhook signature FIRST before any processing
  if (webhookSecret) {
    if (!signature) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing webhook signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const isValid = await verifyHmacSha256(rawBody, signature, webhookSecret);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid webhook signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Malformed JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const eventType = event.type || event.event;
  const data = event.data || {};
  const metadata = data.metadata || data.customer?.metadata || {};
  const uid = metadata.uid;

  if (!uid) {
    // If no UID is associated, acknowledge event to avoid webhook retries
    return new Response(JSON.stringify({ received: true, note: 'No UID in metadata' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const projectId = context.env?.FIREBASE_PROJECT_ID;

  // 2. Dispatch events
  switch (eventType) {
    case 'subscription.created':
    case 'subscription.updated': {
      let targetPlan = metadata.plan || 'pro';
      const productId = data.product_id || '';

      if (productId.includes('agency')) targetPlan = 'agency';
      else if (productId.includes('enterprise')) targetPlan = 'enterprise';
      else if (productId.includes('pro')) targetPlan = 'pro';

      const limits = PLAN_LIMITS[targetPlan] || PLAN_LIMITS.pro;

      await updateFirestoreUser(uid, projectId, {
        plan: targetPlan,
        audits_limit: limits.audits_limit,
        projects_limit: limits.projects_limit,
        subscription_status: 'active',
        dodo_subscription_id: data.subscription_id || data.id,
        dodo_customer_id: data.customer_id || data.customer?.customer_id,
        updated_at: new Date().toISOString()
      });
      break;
    }

    case 'subscription.cancelled': {
      // In SaaS billing, check if cancel_at_period_end is set
      const cancelAtPeriodEnd = data.cancel_at_period_end || data.status === 'cancelling';
      const periodEnd = data.current_period_end || data.next_billing_date;

      if (cancelAtPeriodEnd && periodEnd && new Date(periodEnd).getTime() > Date.now()) {
        // Honor current period until periodEnd; mark status as cancelling
        await updateFirestoreUser(uid, projectId, {
          subscription_status: 'cancelling',
          cancellation_effective_at: periodEnd,
          updated_at: new Date().toISOString()
        });
      } else {
        // Immediate downgrade or period has expired
        const freeLimits = PLAN_LIMITS.free;
        await updateFirestoreUser(uid, projectId, {
          plan: 'free',
          audits_limit: freeLimits.audits_limit,
          projects_limit: freeLimits.projects_limit,
          subscription_status: 'cancelled',
          updated_at: new Date().toISOString()
        });
      }
      break;
    }

    case 'payment.failed': {
      // Payment failure: Plan is NOT immediately cancelled (grace period logic)
      console.warn(`Payment failed for user ${uid}, subscription ${data.subscription_id}`);
      await updateFirestoreUser(uid, projectId, {
        payment_status: 'failed',
        payment_failed_at: new Date().toISOString(),
        has_payment_alert: true,
        updated_at: new Date().toISOString()
      });
      break;
    }

    default:
      // Acknowledge other events
      break;
  }

  return new Response(JSON.stringify({ success: true, event: eventType }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Updates user document in Firestore via REST API
 */
async function updateFirestoreUser(uid, projectId, fieldsToUpdate) {
  if (!projectId) return;

  const fields = {};
  const fieldPaths = [];

  for (const [key, value] of Object.entries(fieldsToUpdate)) {
    fieldPaths.push(`updateMask.fieldPaths=${key}`);
    if (typeof value === 'number') {
      fields[key] = { integerValue: value.toString() };
    } else {
      fields[key] = { stringValue: String(value) };
    }
  }

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}?${fieldPaths.join('&')}`;

  try {
    await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
  } catch (err) {
    console.error('Firestore webhook update error:', err);
  }
}

/**
 * Validates HMAC-SHA256 signature
 */
async function verifyHmacSha256(payload, signature, secret) {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify', 'sign']
    );

    // Signature can be hex or base64
    let sigBytes;
    const cleanSig = signature.replace(/^t=\d+,v1=/, '').trim();

    if (/^[0-9a-fA-F]+$/.test(cleanSig)) {
      sigBytes = new Uint8Array(cleanSig.length / 2);
      for (let i = 0; i < cleanSig.length; i += 2) {
        sigBytes[i / 2] = parseInt(cleanSig.substr(i, 2), 16);
      }
    } else {
      const bin = atob(cleanSig);
      sigBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) sigBytes[i] = bin.charCodeAt(i);
    }

    return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
  } catch {
    return false;
  }
}
