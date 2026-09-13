/**
 * Cloudflare Pages Function: POST /api/checkout
 * Creates a Dodo Payments subscription checkout session
 * 
 * Supports monthly and annual billing intervals with real Dodo product IDs.
 * Live URL: https://live.dodopayments.com
 */

// Real Dodo Product ID mapping
const PRODUCT_IDS = {
  pro: {
    monthly: 'pdt_0NnVqvYKl7HE2QTH62MUF',
    annual: 'pdt_0NnVr2i7mTMWbfuOq6O2v'
  },
  agency: {
    monthly: 'pdt_0NnVqxqTM0vZWwz9YyeWN',
    annual: 'pdt_0NnVr4cqJbCV7CQaRim52'
  },
  enterprise: {
    monthly: 'pdt_0NnVr0MTe39CIYMf9ormf',
    annual: 'pdt_0NnVr6msV9c2vfvJ5D8cA'
  }
};

export async function onRequestPost(context) {
  // ── 1. Auth ──────────────────────────────────────────────
  const authHeader = context.request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized: Missing or invalid token' }, 401);
  }

  const token = authHeader.substring(7).trim();
  let uid = 'unknown_user';
  let email = 'developer@rankforge.app';
  let name = 'RankForge Developer';

  try {
    if (token.startsWith('rf_dev_')) {
      uid = token.replace('rf_dev_', '');
      email = `${uid}@rankforge.app`;
    } else {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        uid = payload.user_id || payload.sub || uid;
        email = payload.email || email;
        name = payload.name || payload.email?.split('@')[0] || name;
      }
    }
  } catch {
    // Non-blocking fallback — UID extraction is best-effort
  }

  // ── 2. Parse Body ────────────────────────────────────────
  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: 'Malformed JSON body' }, 400);
  }

  const plan = body.plan;
  const interval = body.interval || 'monthly'; // 'monthly' | 'annual'
  const returnUrl = body.return_url || 'https://rankforge.app/dashboard.html?upgrade=success';

  if (!plan || !['pro', 'agency', 'enterprise'].includes(plan)) {
    return jsonResponse({ error: 'Invalid plan. Must be: pro, agency, or enterprise' }, 400);
  }

  if (!['monthly', 'annual'].includes(interval)) {
    return jsonResponse({ error: 'Invalid interval. Must be: monthly or annual' }, 400);
  }

  // ── 3. Resolve Product ID ────────────────────────────────
  // Priority: env var override > hardcoded map
  const envKey = `DODO_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
  const productId = context.env?.[envKey] || PRODUCT_IDS[plan]?.[interval];

  if (!productId) {
    return jsonResponse({ error: 'Product configuration missing for this plan/interval' }, 500);
  }

  // ── 4. Build return URL with metadata ────────────────────
  const fullReturnUrl = appendParams(returnUrl, { plan, interval });

  // ── 5. Dodo API Key ──────────────────────────────────────
  const dodoApiKey = context.env?.DODO_API_KEY;
  const baseUrl = context.env?.DODO_BASE_URL || 'https://live.dodopayments.com';

  if (!dodoApiKey) {
    return jsonResponse({ error: 'Payment gateway not configured. Contact support.' }, 503);
  }

  // ── 6. Create Checkout Session via Dodo API ──────────────
  try {
    const checkoutPayload = {
      product_cart: [
        {
          product_id: productId,
          quantity: 1
        }
      ],
      payment_link: true,
      return_url: fullReturnUrl,
      customer: {
        email,
        name
      },
      metadata: {
        uid,
        plan,
        interval,
        source: 'rankforge_checkout'
      }
    };

    const checkoutRes = await fetch(`${baseUrl}/checkout_sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${dodoApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(checkoutPayload)
    });

    if (checkoutRes.ok) {
      const data = await checkoutRes.json();
      const url = data.checkout_url || data.payment_link || data.url;
      if (url) {
        return jsonResponse({
          checkout_url: url,
          session_id: data.checkout_session_id || data.id,
          product_id: productId,
          plan,
          interval
        });
      }
    }

    // If checkout_sessions fails, try the subscriptions endpoint (fallback)
    const subRes = await fetch(`${baseUrl}/subscriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${dodoApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        product_id: productId,
        quantity: 1,
        payment_link: true,
        return_url: fullReturnUrl,
        customer: { email, name },
        metadata: { uid, plan, interval }
      })
    });

    if (subRes.ok) {
      const subData = await subRes.json();
      const url = subData.payment_link || subData.checkout_url || subData.url;
      if (url) {
        return jsonResponse({
          checkout_url: url,
          subscription_id: subData.subscription_id || subData.id,
          product_id: productId,
          plan,
          interval
        });
      }
    }

    // Both endpoints failed — return error with details
    const errText = await checkoutRes.text().catch(() => 'Unknown error');
    console.error('Dodo Payments API error:', errText);
    return jsonResponse({
      error: 'Failed to create checkout session',
      details: errText
    }, 502);

  } catch (err) {
    console.error('Dodo Payments network error:', err);
    return jsonResponse({ error: 'Payment service unavailable. Please try again.' }, 503);
  }
}

// ── Helpers ────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function appendParams(url, params) {
  const separator = url.includes('?') ? '&' : '?';
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${url}${separator}${qs}`;
}
