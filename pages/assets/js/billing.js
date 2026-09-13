/**
 * RankForge Billing Module - Dodo Payments Integration
 * Handles plan checkout sessions via Cloudflare Pages API
 * Supports monthly/annual billing interval toggle
 */

import { getUserAuthToken } from './auth.js';

// ── Product ID Map (mirrors backend, used only for fallback URLs) ──
const PRODUCT_IDS = {
  pro:        { monthly: 'pdt_0NnVqvYKl7HE2QTH62MUF', annual: 'pdt_0NnVr2i7mTMWbfuOq6O2v' },
  agency:     { monthly: 'pdt_0NnVqxqTM0vZWwz9YyeWN', annual: 'pdt_0NnVr4cqJbCV7CQaRim52' },
  enterprise: { monthly: 'pdt_0NnVr0MTe39CIYMf9ormf', annual: 'pdt_0NnVr6msV9c2vfvJ5D8cA' }
};

export const PRICING_PLANS = {
  free: {
    name: 'Free',
    price: 0,
    projects: 1,
    audits: 10
  },
  pro: {
    name: 'Pro',
    priceMonthly: 29,
    priceAnnual: 24,
    projects: 5,
    audits: 100
  },
  agency: {
    name: 'Agency',
    priceMonthly: 79,
    priceAnnual: 64,
    projects: 25,
    audits: 500
  },
  enterprise: {
    name: 'Enterprise',
    priceMonthly: 199,
    priceAnnual: 159,
    projects: 999999,
    audits: 999999
  }
};

// Track current billing interval globally
let currentInterval = 'monthly';

export function initBilling() {
  const toggle = document.getElementById('billingIntervalToggle');
  const pricePro = document.getElementById('pricePro');
  const priceAgency = document.getElementById('priceAgency');
  const priceEnterprise = document.getElementById('priceEnterprise');

  if (toggle) {
    toggle.addEventListener('change', (e) => {
      currentInterval = e.target.checked ? 'annual' : 'monthly';
      if (pricePro) pricePro.textContent = currentInterval === 'annual' ? '$24' : '$29';
      if (priceAgency) priceAgency.textContent = currentInterval === 'annual' ? '$64' : '$79';
      if (priceEnterprise) priceEnterprise.textContent = currentInterval === 'annual' ? '$159' : '$199';

      // Update button labels
      document.querySelectorAll('[data-plan-checkout]').forEach(btn => {
        const plan = btn.getAttribute('data-plan-checkout');
        if (plan !== 'free') {
          const suffix = currentInterval === 'annual' ? '/yr' : '/mo';
          const price = currentInterval === 'annual'
            ? PRICING_PLANS[plan]?.priceAnnual
            : PRICING_PLANS[plan]?.priceMonthly;
          // Only update if not currently processing
          if (!btn.disabled) {
            btn.textContent = `Get ${PRICING_PLANS[plan]?.name || plan}`;
          }
        }
      });
    });
  }

  // Bind checkout buttons
  document.querySelectorAll('[data-plan-checkout]').forEach(button => {
    button.addEventListener('click', (e) => {
      const planKey = e.currentTarget.getAttribute('data-plan-checkout');
      handleCheckout(planKey);
    });
  });

  // Also bind upgrade buttons on dashboard
  document.querySelectorAll('[data-upgrade-plan]').forEach(button => {
    button.addEventListener('click', (e) => {
      const planKey = e.currentTarget.getAttribute('data-upgrade-plan');
      handleCheckout(planKey);
    });
  });
}

/**
 * Initiates Dodo Payments subscription checkout session
 */
export async function handleCheckout(planKey) {
  if (planKey === 'free') {
    window.location.href = '/login.html';
    return;
  }

  const btn = document.querySelector(`[data-plan-checkout="${planKey}"], [data-upgrade-plan="${planKey}"]`);
  const originalText = btn ? btn.textContent : '';

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-inline"></span> Creating checkout...';
  }

  try {
    const token = await getUserAuthToken();

    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        plan: planKey,
        interval: currentInterval,
        return_url: `${window.location.origin}/dashboard.html?upgrade=success`
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to create checkout session');
    }

    const data = await response.json();
    if (data.checkout_url) {
      // Redirect to Dodo Payments hosted checkout
      window.location.href = data.checkout_url;
    } else {
      throw new Error('No checkout URL returned from payment gateway');
    }
  } catch (error) {
    console.error('Checkout error:', error.message);

    // Fallback: Direct Dodo hosted checkout link (live)
    const productId = PRODUCT_IDS[planKey]?.[currentInterval];
    if (productId) {
      const returnUrl = encodeURIComponent(`${window.location.origin}/dashboard.html?upgrade=success&plan=${planKey}&interval=${currentInterval}`);
      window.location.href = `https://live.dodopayments.com/buy/${productId}?quantity=1&return_url=${returnUrl}`;
    } else {
      showCheckoutError(error.message || 'Payment service unavailable. Please try again.');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

/**
 * Shows a toast error message for checkout failures
 */
function showCheckoutError(message) {
  const existing = document.querySelector('.checkout-error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'checkout-error-toast';
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.5rem;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
      <span>${message}</span>
    </div>
  `;
  toast.style.cssText = `
    position:fixed;bottom:2rem;right:2rem;padding:1rem 1.5rem;
    background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);
    border-radius:12px;color:#fca5a5;font-size:0.88rem;z-index:9999;
    backdrop-filter:blur(12px);animation:slideInRight 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

/**
 * Highlights active plan on pricing page if user is logged in
 */
export async function highlightCurrentPlan() {
  try {
    const token = await getUserAuthToken();
    if (!token) return;

    const res = await fetch('/api/user', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;

    const data = await res.json();
    const currentPlan = (data.plan || 'free').toLowerCase();

    document.querySelectorAll('[data-plan-card]').forEach(card => {
      const plan = card.getAttribute('data-plan-card');
      if (plan === currentPlan) {
        card.style.borderColor = 'var(--color-success)';
        card.style.boxShadow = '0 0 0 1px var(--color-success)';

        const badge = document.createElement('div');
        badge.className = 'badge badge-success';
        badge.textContent = 'CURRENT PLAN';
        badge.style.marginBottom = '0.5rem';
        badge.style.alignSelf = 'flex-start';
        card.prepend(badge);

        const btn = card.querySelector('[data-plan-checkout], a[href*="login"]');
        if (btn) {
          btn.textContent = 'Active Plan ✓';
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-secondary');
          btn.disabled = true;
          btn.style.opacity = '0.75';
          btn.style.cursor = 'default';
        }
      }
    });
  } catch {
    // Non-blocking
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('pricePro')) {
    initBilling();
    highlightCurrentPlan();
  }
});
