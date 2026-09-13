/**
 * Cloudflare Pages Function: POST /api/webhook/dodo
 * Handles Dodo Payments Webhooks for subscription lifecycle events
 * 
 * Matches real product IDs to plan tiers for Firestore updates.
 */

const PLAN_LIMITS = {
  free: { audits_limit: 10, projects_limit: 1 },
  pro: { audits_limit: 100, projects_limit: 5 },
  agency: { audits_limit: 500, projects_limit: 25 },
  enterprise: { audits_limit: 999999, projects_limit: 999999 }
};

// Real Dodo Product ID → Plan mapping
const PRODUCT_TO_PLAN = {
  // Monthly
  'pdt_0NnVqvYKl7HE2QTH62MUF': 'pro',
  'pdt_0NnVqxqTM0vZWwz9YyeWN': 'agency',
  'pdt_0NnVr0MTe39CIYMf9ormf': 'enterprise',
  // Annual
  'pdt_0NnVr2i7mTMWbfuOq6O2v': 'pro',
  'pdt_0NnVr4cqJbCV7CQaRim52': 'agency',
  'pdt_0NnVr6msV9c2vfvJ5D8cA': 'enterprise'
};

export async function onRequestPost(context) {
  const rawBody = await context.request.text();
  const signature = context.request.headers.get('webhook-signature') ||
                    context.request.headers.get('x-dodo-signature') ||
                    context.request.headers.get('signature');

  const webhookSecret = context.env?.DODO_WEBHOOK_SECRET;

  // 1. Verify webhook signature FIRST before any processing
  if (webhookSecret && webhookSecret !== 'your_webhook_secret') {
    if (!signature) {
      return jsonResponse({ error: 'Unauthorized: Missing webhook signature' }, 401);
    }
    const isValid = await verifyHmacSha256(rawBody, signature, webhookSecret);
    if (!isValid) {
      return jsonResponse({ error: 'Unauthorized: Invalid webhook signature' }, 401);
    }
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Malformed JSON payload' }, 400);
  }

  const eventType = event.type || event.event;
  const data = event.data || {};
  const metadata = data.metadata || data.customer?.metadata || {};
  const uid = metadata.uid;

  if (!uid) {
    // If no UID is associated, acknowledge event to avoid webhook retries
    return jsonResponse({ received: true, note: 'No UID in metadata' });
  }

  const projectId = context.env?.FIREBASE_PROJECT_ID;

  // 2. Dispatch events
  switch (eventType) {
    case 'subscription.created':
    case 'subscription.updated':
    case 'checkout.completed': {
      // Determine plan from product ID first, then metadata fallback
      const productId = data.product_id || data.items?.[0]?.product_id || '';
      let targetPlan = PRODUCT_TO_PLAN[productId] || metadata.plan || 'pro';

      // Secondary fallback: check product name
      if (!PRODUCT_TO_PLAN[productId]) {
        if (productId.includes('enterprise') || data.name?.includes('Enterprise')) targetPlan = 'enterprise';
        else if (productId.includes('agency') || data.name?.includes('Agency')) targetPlan = 'agency';
        else if (productId.includes('pro') || data.name?.includes('Pro')) targetPlan = 'pro';
      }

      const limits = PLAN_LIMITS[targetPlan] || PLAN_LIMITS.pro;
      const interval = metadata.interval || 
        (data.price_detail?.payment_frequency_interval === 'Year' ? 'annual' : 'monthly');

      await updateFirestoreUser(uid, projectId, {
        plan: targetPlan,
        billing_interval: interval,
        audits_limit: limits.audits_limit,
        projects_limit: limits.projects_limit,
        subscription_status: 'active',
        dodo_subscription_id: data.subscription_id || data.id,
        dodo_customer_id: data.customer_id || data.customer?.customer_id,
        dodo_product_id: productId,
        updated_at: new Date().toISOString()
      });
      break;
    }

    case 'subscription.cancelled': {
      const cancelAtPeriodEnd = data.cancel_at_period_end || data.status === 'cancelling';
      const periodEnd = data.current_period_end || data.next_billing_date;

      if (cancelAtPeriodEnd && periodEnd && new Date(periodEnd).getTime() > Date.now()) {
        await updateFirestoreUser(uid, projectId, {
          subscription_status: 'cancelling',
          cancellation_effective_at: periodEnd,
          updated_at: new Date().toISOString()
        });
      } else {
        const freeLimits = PLAN_LIMITS.free;
        await updateFirestoreUser(uid, projectId, {
          plan: 'free',
          audits_limit: freeLimits.audits_limit,
          projects_limit: freeLimits.projects_limit,
          subscription_status: 'cancelled',
          dodo_subscription_id: '',
          updated_at: new Date().toISOString()
        });
      }
      break;
    }

    case 'payment.failed': {
      console.warn(`Payment failed for user ${uid}, subscription ${data.subscription_id}`);
      await updateFirestoreUser(uid, projectId, {
        payment_status: 'failed',
        payment_failed_at: new Date().toISOString(),
        has_payment_alert: true,
        updated_at: new Date().toISOString()
      });
      break;
    }

    case 'payment.succeeded': {
      await updateFirestoreUser(uid, projectId, {
        payment_status: 'succeeded',
        has_payment_alert: false,
        last_payment_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      break;
    }

    default:
      // Acknowledge other events
      break;
  }

  return jsonResponse({ success: true, event: eventType });
}

// ── Helpers ────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
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
    } else if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
    } else {
      fields[key] = { stringValue: String(value) };
    }
  }

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}?${fieldPaths.join('&')}`;

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Firestore update error:', errText);
    }
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
