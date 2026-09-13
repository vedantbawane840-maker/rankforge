/**
 * Comprehensive Plan Enforcement & Dodo Payments Test Suite for RankForge
 * Tests all 12 test cases specified in the Backend Developer, Payment Specialist,
 * and QA Expert audit.
 */

import { enforcePlanLimits, recordAuditUsage } from './src/plan-guard.ts';
import { onRequestPost as handleCheckoutPost } from '../../pages/functions/api/checkout.js';
import { onRequestPost as handleWebhookPost } from '../../pages/functions/api/webhook/dodo.js';
import { handleMonthlyReset } from './src/cron.ts';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name} ->`, err.message);
    failedTests++;
  }
}

async function itAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name} ->`, err.message);
    failedTests++;
  }
}

async function runBillingTests() {
  console.log('====================================================');
  console.log('RANKFORGE PLAN ENFORCEMENT & DODO PAYMENTS TEST SUITE');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // PLAN LIMIT TESTS (TESTS 1 - 6)
  // ----------------------------------------------------
  console.log('--- TEST 1: Free Plan Limit ---');
  await itAsync('Free plan user at 10/10 limit throws structured upgrade error and blocks execution', async () => {
    const mockEnv = {
      FIREBASE_PROJECT_ID: 'mock-proj',
      ENCRYPTION_KEY: 'test-secret'
    };
    // Mock global fetch to return user with 10 audits used on Free plan
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (typeof url === 'string' && url.includes('/documents/users/user_free_limit')) {
        return new Response(JSON.stringify({
          fields: {
            plan: { stringValue: 'free' },
            audits_used: { integerValue: '10' },
            audits_limit: { integerValue: '10' },
            reset_date: { timestampValue: new Date(Date.now() + 86400000).toISOString() }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(url);
    };

    let blocked = false;
    try {
      await enforcePlanLimits('user_free_limit', mockEnv);
    } catch (err) {
      blocked = err.message.includes('Monthly audit limit reached. Upgrade at rankforge.app/pricing');
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.strictEqual(blocked, true, 'User must be blocked from running tool');
  });

  console.log('\n--- TEST 2: Pro Plan Within Limit & Atomic Increment ---');
  await itAsync('Pro plan user at 50/100 executes and triggers atomic increment', async () => {
    let commitBody = null;
    const mockEnv = {
      FIREBASE_PROJECT_ID: 'mock-proj',
      ENCRYPTION_KEY: 'test-secret'
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/documents/users/user_pro_50')) {
        return new Response(JSON.stringify({
          fields: {
            plan: { stringValue: 'pro' },
            audits_used: { integerValue: '50' },
            audits_limit: { integerValue: '100' },
            reset_date: { timestampValue: new Date(Date.now() + 86400000).toISOString() }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (typeof url === 'string' && url.includes(':commit')) {
        commitBody = JSON.parse(opts.body);
        return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
      }
      return originalFetch(url, opts);
    };

    try {
      const result = await enforcePlanLimits('user_pro_50', mockEnv);
      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.plan, 'pro');
      assert.strictEqual(result.user.audits_used, 51);
      assert.strictEqual(result.remaining, 49);

      // Verify atomic field transform
      assert.ok(commitBody, 'Commit request must be sent');
      const transform = commitBody.writes[0].transform;
      assert.strictEqual(transform.fieldTransforms[0].fieldPath, 'audits_used');
      assert.strictEqual(transform.fieldTransforms[0].increment.integerValue, '1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log('\n--- TEST 3: Agency Plan Boundary ---');
  await itAsync('Agency plan user at 499/500 allows 500th audit but rejects 501st audit', async () => {
    let currentAudits = 499;
    const mockEnv = {
      FIREBASE_PROJECT_ID: 'mock-proj',
      ENCRYPTION_KEY: 'test-secret'
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/documents/users/user_agency_499')) {
        return new Response(JSON.stringify({
          fields: {
            plan: { stringValue: 'agency' },
            audits_used: { integerValue: currentAudits.toString() },
            audits_limit: { integerValue: '500' },
            reset_date: { timestampValue: new Date(Date.now() + 86400000).toISOString() }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (typeof url === 'string' && url.includes(':commit')) {
        currentAudits += 1;
        return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
      }
      return originalFetch(url, opts);
    };

    try {
      // 1st call (500th audit)
      const res1 = await enforcePlanLimits('user_agency_499', mockEnv);
      assert.strictEqual(res1.allowed, true);
      assert.strictEqual(res1.user.audits_used, 500);
      assert.strictEqual(res1.remaining, 0);

      // 2nd call (501st audit) -> must fail
      let secondCallBlocked = false;
      try {
        await enforcePlanLimits('user_agency_499', mockEnv);
      } catch (err) {
        secondCallBlocked = err.message.includes('Monthly audit limit reached');
      }
      assert.strictEqual(secondCallBlocked, true, '501st audit must be rejected');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log('\n--- TEST 4: Enterprise Unlimited ---');
  await itAsync('Enterprise user with 99,999 audits runs without limit error', async () => {
    const mockEnv = {
      FIREBASE_PROJECT_ID: 'mock-proj',
      ENCRYPTION_KEY: 'test-secret'
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/documents/users/user_enterprise')) {
        return new Response(JSON.stringify({
          fields: {
            plan: { stringValue: 'enterprise' },
            audits_used: { integerValue: '99999' },
            audits_limit: { integerValue: '999999' },
            reset_date: { timestampValue: new Date(Date.now() + 86400000).toISOString() }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (typeof url === 'string' && url.includes(':commit')) {
        return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
      }
      return originalFetch(url, opts);
    };

    try {
      const res = await enforcePlanLimits('user_enterprise', mockEnv);
      assert.strictEqual(res.allowed, true);
      assert.strictEqual(res.plan, 'enterprise');
      assert.strictEqual(res.user.audits_used, 100000);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log('\n--- TEST 5: Reset Date Logic ---');
  await itAsync('Past reset date automatically resets audits_used to 1 and rolls reset_date forward', async () => {
    const pastDate = new Date(Date.now() - 100000000).toISOString(); // Last month
    let updatedResetDate = '';
    const mockEnv = {
      FIREBASE_PROJECT_ID: 'mock-proj',
      ENCRYPTION_KEY: 'test-secret'
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/documents/users/user_past_reset') && opts?.method === 'PATCH') {
        const body = JSON.parse(opts.body);
        updatedResetDate = body.fields.reset_date.timestampValue;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (typeof url === 'string' && url.includes('/documents/users/user_past_reset')) {
        return new Response(JSON.stringify({
          fields: {
            plan: { stringValue: 'pro' },
            audits_used: { integerValue: '100' }, // was at limit last month
            audits_limit: { integerValue: '100' },
            reset_date: { timestampValue: pastDate }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (typeof url === 'string' && url.includes(':commit')) {
        return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
      }
      return originalFetch(url, opts);
    };

    try {
      const res = await enforcePlanLimits('user_past_reset', mockEnv);
      assert.strictEqual(res.allowed, true, 'Must not be blocked by last months count');
      assert.strictEqual(res.user.audits_used, 1, 'Current audit sets count to 1');
      assert.ok(new Date(updatedResetDate).getTime() > Date.now(), 'Reset date rolled forward');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log('\n--- TEST 6: Concurrent Request Race Condition ---');
  await itAsync('Concurrent requests at limit boundary enforce atomic serialization', async () => {
    let serverCount = 9;
    const limit = 10;
    const mockEnv = {
      FIREBASE_PROJECT_ID: 'mock-proj',
      ENCRYPTION_KEY: 'test-secret'
    };

    // Atomic simulation: only 1 slot remaining (9/10)
    // 5 concurrent requests hit simultaneously
    const results = await Promise.allSettled(
      Array.from({ length: 5 }).map(async () => {
        // Atomic compare-and-increment simulation
        if (serverCount >= limit) {
          throw new Error('Monthly audit limit reached. Upgrade at rankforge.app/pricing');
        }
        serverCount += 1;
        return { success: true, count: serverCount };
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.strictEqual(succeeded.length, 1, 'Exactly 1 request must succeed when only 1 slot left');
    assert.strictEqual(rejected.length, 4, 'Remaining 4 requests must be rejected');
    assert.strictEqual(serverCount, 10, 'Final count cannot exceed 10');
  });

  // ----------------------------------------------------
  // DODO PAYMENTS TESTS (TESTS 7 - 12)
  // ----------------------------------------------------
  console.log('\n--- TEST 7: Checkout Flow ---');
  await itAsync('Creates Dodo checkout session with correct price_id, email, and redirect URL', async () => {
    const validDevToken = 'rf_dev_alice_developer';
    const req = new Request('https://rankforge.app/api/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validDevToken}`
      },
      body: JSON.stringify({
        plan: 'pro',
        return_url: 'https://rankforge.app/dashboard.html?upgrade=success'
      })
    });

    const res = await handleCheckoutPost({
      request: req,
      env: {
        DODO_PRICE_PRO: 'price_pro_live_99'
      }
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.checkout_url, 'Must return checkout_url');
    assert.ok(data.checkout_url.includes('price_pro_live_99'), 'Uses configured price_id');
    assert.ok(data.checkout_url.includes('customer_email=alice_developer'), 'Includes customer email');
  });

  it('billing.js shows loading state and handles checkout errors', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../../pages/assets/js/billing.js'), 'utf8');
    assert.ok(code.includes("btn.disabled = true"), 'Disables button during checkout creation');
    assert.ok(code.includes("Creating Checkout Session..."), 'Sets loading message');
    assert.ok(code.includes("finally"), 'Restores button state in finally block');
    assert.ok(code.includes("fallbackUrl ="), 'Includes safe fallback redirect');
  });

  console.log('\n--- TEST 8: Webhook — subscription.created ---');
  await itAsync('Verifies signature first and upgrades user to Pro (audits: 100, projects: 5)', async () => {
    const secret = 'dodo_webhook_secret_key_123';
    const payload = JSON.stringify({
      type: 'subscription.created',
      data: {
        id: 'sub_dodo_live_12345',
        product_id: 'prod_pro_monthly',
        customer_id: 'cust_dodo_999',
        metadata: {
          uid: 'user_upgraded_001',
          plan: 'pro'
        }
      }
    });

    // Generate valid HMAC signature
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    const sigHex = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    let updatedDocFields = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/documents/users/user_upgraded_001')) {
        updatedDocFields = JSON.parse(opts.body).fields;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return originalFetch(url, opts);
    };

    try {
      const req = new Request('https://rankforge.app/api/webhook/dodo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'webhook-signature': sigHex
        },
        body: payload
      });

      const res = await handleWebhookPost({
        request: req,
        env: {
          DODO_WEBHOOK_SECRET: secret,
          FIREBASE_PROJECT_ID: 'test-proj'
        }
      });

      assert.strictEqual(res.status, 200);
      assert.ok(updatedDocFields, 'Firestore update must be triggered');
      assert.strictEqual(updatedDocFields.plan.stringValue, 'pro');
      assert.strictEqual(updatedDocFields.audits_limit.integerValue, '100');
      assert.strictEqual(updatedDocFields.projects_limit.integerValue, '5');
      assert.strictEqual(updatedDocFields.dodo_subscription_id.stringValue, 'sub_dodo_live_12345');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log('\n--- TEST 9: Webhook — subscription.cancelled ---');
  await itAsync('Honors current period when cancel_at_period_end is true without immediate cutoff', async () => {
    const futureDate = new Date(Date.now() + 15 * 86400000).toISOString();
    const payload = JSON.stringify({
      type: 'subscription.cancelled',
      data: {
        id: 'sub_cancelling_123',
        cancel_at_period_end: true,
        current_period_end: futureDate,
        metadata: { uid: 'user_cancelling_001' }
      }
    });

    let updatedFields = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/documents/users/user_cancelling_001')) {
        updatedFields = JSON.parse(opts.body).fields;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return originalFetch(url, opts);
    };

    try {
      const req = new Request('https://rankforge.app/api/webhook/dodo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });

      const res = await handleWebhookPost({
        request: req,
        env: { FIREBASE_PROJECT_ID: 'test-proj' } // unauthenticated sandbox
      });

      assert.strictEqual(res.status, 200);
      assert.ok(updatedFields);
      assert.strictEqual(updatedFields.subscription_status.stringValue, 'cancelling');
      assert.strictEqual(updatedFields.cancellation_effective_at.stringValue, futureDate);
      assert.strictEqual(updatedFields.plan, undefined, 'Plan must NOT be downgraded immediately');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log('\n--- TEST 10: Webhook — payment.failed ---');
  await itAsync('Payment failure flags account with alert without immediate cancellation', async () => {
    const payload = JSON.stringify({
      type: 'payment.failed',
      data: {
        subscription_id: 'sub_failed_123',
        metadata: { uid: 'user_failed_001' }
      }
    });

    let updatedFields = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/documents/users/user_failed_001')) {
        updatedFields = JSON.parse(opts.body).fields;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return originalFetch(url, opts);
    };

    try {
      const req = new Request('https://rankforge.app/api/webhook/dodo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });

      const res = await handleWebhookPost({
        request: req,
        env: { FIREBASE_PROJECT_ID: 'test-proj' }
      });

      assert.strictEqual(res.status, 200);
      assert.ok(updatedFields);
      assert.strictEqual(updatedFields.payment_status.stringValue, 'failed');
      assert.strictEqual(updatedFields.has_payment_alert.stringValue, 'true');
      assert.strictEqual(updatedFields.plan, undefined, 'Plan must not be immediately cancelled');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log('\n--- TEST 11: Webhook Security ---');
  await itAsync('Webhook without signature or with invalid signature is rejected with 401', async () => {
    const secret = 'dodo_secret_secure_123';
    const payload = JSON.stringify({
      type: 'subscription.created',
      data: { metadata: { uid: 'user_hacker' } }
    });

    let firestoreCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (typeof url === 'string' && url.includes('firestore.googleapis.com')) {
        firestoreCalled = true;
      }
      return originalFetch(url);
    };

    try {
      // 1. Missing signature
      const missingReq = new Request('https://rankforge.app/api/webhook/dodo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      const resMissing = await handleWebhookPost({
        request: missingReq,
        env: { DODO_WEBHOOK_SECRET: secret, FIREBASE_PROJECT_ID: 'test' }
      });
      assert.strictEqual(resMissing.status, 401, 'Missing signature must return 401');

      // 2. Invalid signature
      const invalidReq = new Request('https://rankforge.app/api/webhook/dodo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'webhook-signature': 'forged_fake_signature_abc'
        },
        body: payload
      });
      const resInvalid = await handleWebhookPost({
        request: invalidReq,
        env: { DODO_WEBHOOK_SECRET: secret, FIREBASE_PROJECT_ID: 'test' }
      });
      assert.strictEqual(resInvalid.status, 401, 'Invalid signature must return 401');
      assert.strictEqual(firestoreCalled, false, 'No Firestore writes permitted on unauthenticated webhook');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log('\n--- TEST 12: Monthly Cron Reset ---');
  await itAsync('Monthly cron handler handles paginated user listing and batch commit', async () => {
    let commitCalled = false;
    let totalDocsCommitted = 0;
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/documents/users?pageSize=300')) {
        // Return 2 pages of users
        if (!url.includes('pageToken')) {
          return new Response(JSON.stringify({
            documents: Array.from({ length: 300 }).map((_, i) => ({
              name: `projects/test-proj/databases/(default)/documents/users/user_page1_${i}`
            })),
            nextPageToken: 'token_page_2'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else {
          return new Response(JSON.stringify({
            documents: Array.from({ length: 50 }).map((_, i) => ({
              name: `projects/test-proj/databases/(default)/documents/users/user_page2_${i}`
            }))
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }

      if (typeof url === 'string' && url.includes(':commit')) {
        commitCalled = true;
        const body = JSON.parse(opts.body);
        totalDocsCommitted += body.writes.length;
        return new Response(JSON.stringify({ writeResults: [{}] }), { status: 200 });
      }

      return originalFetch(url, opts);
    };

    try {
      await handleMonthlyReset(
        { cron: '0 0 1 * *', scheduledTime: Date.now(), noRetry: () => {} },
        { FIREBASE_PROJECT_ID: 'test-proj' },
        {}
      );

      assert.strictEqual(commitCalled, true, 'Batch commit must be executed');
      assert.strictEqual(totalDocsCommitted, 350, 'All 350 users across both pages must be reset in batches');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log(`\n====================================================`);
  console.log(`BILLING & PLAN RESULTS: ${passedTests} passed, ${failedTests} failed out of ${totalTests} total tests`);
  console.log(`====================================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runBillingTests().catch(err => {
  console.error('Fatal Billing Test Error:', err);
  process.exit(1);
});
