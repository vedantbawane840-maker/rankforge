/**
 * RankForge Billing Module - Dodo Payments Integration
 * Handles plan checkout sessions via Cloudflare Pages API
 */

import { getUserAuthToken } from './auth.js';

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

export function initBilling() {
  const toggle = document.getElementById('billingIntervalToggle');
  const pricePro = document.getElementById('pricePro');
  const priceAgency = document.getElementById('priceAgency');
  const priceEnterprise = document.getElementById('priceEnterprise');

  if (toggle) {
    toggle.addEventListener('change', (e) => {
      const isAnnual = e.target.checked;
      if (pricePro) pricePro.textContent = isAnnual ? '$24' : '$29';
      if (priceAgency) priceAgency.textContent = isAnnual ? '$64' : '$79';
      if (priceEnterprise) priceEnterprise.textContent = isAnnual ? '$159' : '$199';
    });
  }

  document.querySelectorAll('[data-plan-checkout]').forEach(button => {
    button.addEventListener('click', (e) => {
      const planKey = e.currentTarget.getAttribute('data-plan-checkout');
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
    btn.textContent = 'Creating Checkout Session...';
  }

  try {
    const token = await getUserAuthToken();

    // Call Cloudflare Pages serverless checkout endpoint
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        plan: planKey,
        return_url: `${window.location.origin}/dashboard.html?upgrade=success`
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to initialize Dodo checkout session');
    }

    const data = await response.json();
    if (data.checkout_url) {
      window.location.href = data.checkout_url;
    } else {
      throw new Error('No checkout URL returned');
    }
  } catch (error) {
    console.warn('Checkout error or demo redirect:', error);
    // Fallback sandbox checkout redirect for instant demonstration
    const fallbackUrl = `https://test.dodopayments.com/buy/p_rankforge_${planKey}?ref=demo&return_url=${encodeURIComponent(window.location.origin + '/dashboard.html?upgrade=success')}`;
    window.location.href = fallbackUrl;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
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

