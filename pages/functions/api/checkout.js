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

  // If live Dodo API Key is configured, make real API call
  if (dodoApiKey) {
    try {
      // 1. Create or get customer on Dodo Payments
      let customerId = null;
      try {
        const customerRes = await fetch('https://api.dodopayments.com/customers', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${dodoApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email,
            name,
            metadata: { uid }
          })
        });

        if (customerRes.ok) {
          const customerData = await customerRes.json();
          customerId = customerData.customer_id || customerData.id;
        }
      } catch {
        // Continue if customer creation can be inlined
      }

      // 2. Create subscription session
      const subPayload = {
        product_id: selectedPriceId,
        quantity: 1,
        payment_link: true,
        return_url: returnUrl,
        customer: customerId ? { customer_id: customerId } : { email, name },
        metadata: {
          uid,
          plan
        }
      };

      const subRes = await fetch('https://api.dodopayments.com/subscriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${dodoApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(subPayload)
      });

      if (subRes.ok) {
        const subData = await subRes.json();
        const checkoutUrl = subData.payment_link || subData.checkout_url || subData.url;
        if (checkoutUrl) {
          return new Response(JSON.stringify({ checkout_url: checkoutUrl }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    } catch (err) {
      console.error('Dodo Payments API error:', err);
    }
  }

  // Sandbox / Demo Checkout Link fallback
  const testCheckoutUrl = `https://test.dodopayments.com/buy/${selectedPriceId}?quantity=1&return_url=${encodeURIComponent(returnUrl)}&customer_email=${encodeURIComponent(email)}&metadata_uid=${encodeURIComponent(uid)}&metadata_plan=${encodeURIComponent(plan)}`;

  return new Response(JSON.stringify({ checkout_url: testCheckoutUrl }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
