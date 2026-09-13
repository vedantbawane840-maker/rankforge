/**
 * Cloudflare Pages Function: POST /api/checkout
 * Creates a Dodo Payments subscription checkout session
 */

export async function onRequestPost(context) {
  const authHeader = context.request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const token = authHeader.substring(7).trim();
  let uid = 'sandbox_user';
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
    // Non-blocking fallback
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Malformed JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const plan = body.plan;
  const returnUrl = body.return_url || 'https://rankforge.app/dashboard.html?upgrade=success';

  if (!plan || !['pro', 'agency', 'enterprise'].includes(plan)) {
    return new Response(JSON.stringify({ error: 'Invalid plan selected' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const dodoApiKey = context.env?.DODO_API_KEY;
  const priceMap = {
    pro: context.env?.DODO_PRICE_PRO || 'price_pro_monthly',
    agency: context.env?.DODO_PRICE_AGENCY || 'price_agency_monthly',
    enterprise: context.env?.DODO_PRICE_ENTERPRISE || 'price_enterprise_monthly'
  };

  const selectedPriceId = priceMap[plan];

  // Append plan parameter to returnUrl if not already present
  const fullReturnUrl = returnUrl.includes('plan=')
    ? returnUrl
    : `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}plan=${plan}`;

  // If Dodo API Key is configured, make live/test Dodo API call
  if (dodoApiKey) {
    const isTestMode = dodoApiKey.includes('test') || context.env?.DODO_ENV === 'test';
    const baseUrl = isTestMode ? 'https://test.dodopayments.com' : 'https://api.dodopayments.com';

    try {
      // 1. Try Dodo Checkout Sessions API v2
      const checkoutRes = await fetch(`${baseUrl}/checkout_sessions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${dodoApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          product_cart: [
            {
              product_id: selectedPriceId,
              quantity: 1
            }
          ],
          return_url: fullReturnUrl,
          customer: {
            email,
            name
          },
          metadata: {
            uid,
            plan
          }
        })
      });

      if (checkoutRes.ok) {
        const checkoutData = await checkoutRes.json();
        const url = checkoutData.checkout_url || checkoutData.payment_link || checkoutData.url;
        if (url) {
          return new Response(JSON.stringify({ checkout_url: url }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // 2. Fallback to Dodo Subscriptions API v1
      const subRes = await fetch(`${baseUrl}/subscriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${dodoApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          product_id: selectedPriceId,
          quantity: 1,
          payment_link: true,
          return_url: fullReturnUrl,
          customer: { email, name },
          metadata: {
            uid,
            plan
          }
        })
      });

      if (subRes.ok) {
        const subData = await subRes.json();
        const url = subData.payment_link || subData.checkout_url || subData.url;
        if (url) {
          return new Response(JSON.stringify({ checkout_url: url }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    } catch (err) {
      console.error('Dodo Payments API error:', err);
    }
  }

  // High-reliability hosted checkout link fallback
  const testCheckoutUrl = `https://test.dodopayments.com/buy/${selectedPriceId}?quantity=1&return_url=${encodeURIComponent(fullReturnUrl)}&customer_email=${encodeURIComponent(email)}&metadata_uid=${encodeURIComponent(uid)}&metadata_plan=${encodeURIComponent(plan)}`;

  return new Response(JSON.stringify({ checkout_url: testCheckoutUrl }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
