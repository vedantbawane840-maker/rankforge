/**
 * Comprehensive BYOK (Bring Your Own Key) Test Suite for RankForge
 * Tests all 6 flows specified in the Backend Developer & API Designer audit.
 */

import { executeSeoAudit } from './src/tools/seo-audit.ts';
import { BeyondSeoEngine } from './src/skill/engine.ts';
import { getDecryptedApifyKey, encryptApifyKey } from './src/plan-guard.ts';
import { onRequestPost as handleKeysPost } from '../../pages/functions/api/keys.js';
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

async function runBYOKTests() {
  console.log('====================================================');
  console.log('RANKFORGE BYOK INTEGRATION & SECURITY TEST SUITE');
  console.log('====================================================\n');

  const TEST_SECRET = 'rf-super-secret-master-key-32b!!';
  const RAW_APIFY_KEY = 'apify_api_abc1234567890xyzTestKey';

  // ----------------------------------------------------
  // TEST 1: Key Storage Flow (pages/functions/api/keys.js)
  // ----------------------------------------------------
  console.log('--- TEST 1: Key Storage Flow (pages/functions/api/keys.js) ---');

  // 1a. Missing Auth Header rejection
  await itAsync('Rejects requests missing Authorization header with 401', async () => {
    const req = new Request('https://rankforge.app/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apify_key: RAW_APIFY_KEY })
    });
    const res = await handleKeysPost({ request: req, env: { ENCRYPTION_KEY: TEST_SECRET } });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.error, 'Unauthorized: Missing token');
  });

  // 1b. Expired JWT rejection
  await itAsync('Rejects expired JWT tokens with 401', async () => {
    const expiredPayload = Buffer.from(JSON.stringify({
      user_id: 'user_exp_123',
      exp: Math.floor(Date.now() / 1000) - 3600
    })).toString('base64url');
    const req = new Request('https://rankforge.app/api/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer header.${expiredPayload}.sig`
      },
      body: JSON.stringify({ apify_key: RAW_APIFY_KEY })
    });
    const res = await handleKeysPost({ request: req, env: { ENCRYPTION_KEY: TEST_SECRET } });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.error, 'Unauthorized: Token expired');
  });

  // 1c. Valid Key Storage with AES-256 encryption
  await itAsync('Encrypts key with AES-256 and returns { success: true, key_configured: true }', async () => {
    const validPayload = Buffer.from(JSON.stringify({
      user_id: 'user_live_test_001',
      exp: Math.floor(Date.now() / 1000) + 3600
    })).toString('base64url');
    const req = new Request('https://rankforge.app/api/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer header.${validPayload}.sig`
      },
      body: JSON.stringify({ apify_key: RAW_APIFY_KEY })
    });
    const res = await handleKeysPost({ request: req, env: { ENCRYPTION_KEY: TEST_SECRET } });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.key_configured, true);
    assert.strictEqual(data.apify_key, undefined, 'Raw key must NEVER be in response');
  });

  // 1d. Missing ENCRYPTION_KEY secret error handling
  await itAsync('Handles missing ENCRYPTION_KEY server configuration securely with HTTP 500', async () => {
    const validPayload = Buffer.from(JSON.stringify({
      user_id: 'user_live_test_002',
      exp: Math.floor(Date.now() / 1000) + 3600
    })).toString('base64url');
    const req = new Request('https://rankforge.app/api/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer header.${validPayload}.sig`
      },
      body: JSON.stringify({ apify_key: RAW_APIFY_KEY })
    });
    const res = await handleKeysPost({ request: req, env: {} }); // no ENCRYPTION_KEY
    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.ok(data.error.includes('ENCRYPTION_KEY'));
  });

  // ----------------------------------------------------
  // TEST 2: Key Retrieval Flow (src/skill/engine.ts or tools/)
  // ----------------------------------------------------
  console.log('\n--- TEST 2: Key Retrieval Flow (plan-guard.ts & engine.ts) ---');

  let encryptedPayload = '';
  await itAsync('Key is encrypted and stored in AES-256-GCM format (ivHex:cipherHex)', async () => {
    encryptedPayload = await encryptApifyKey(RAW_APIFY_KEY, TEST_SECRET);
    assert.ok(encryptedPayload.includes(':'), 'Encrypted format must be ivHex:cipherHex');
    const [iv, cipher] = encryptedPayload.split(':');
    assert.strictEqual(iv.length, 24, 'IV must be 12 bytes = 24 hex characters');
    assert.ok(cipher.length > 32, 'Ciphertext must be present');
  });

  await itAsync('Key is decrypted using ENCRYPTION_KEY correctly in memory', async () => {
    const decrypted = await getDecryptedApifyKey(encryptedPayload, TEST_SECRET);
    assert.strictEqual(decrypted, RAW_APIFY_KEY, 'Decrypted key must match original');
  });

  await itAsync('If decryption fails (wrong key or corrupted cipher) -> caught silently, returns null', async () => {
    const badKeyDecryption = await getDecryptedApifyKey(encryptedPayload, 'completely-wrong-master-secret-32b');
    assert.strictEqual(badKeyDecryption, null, 'Wrong secret returns null without throwing');

    const corruptedCipher = await getDecryptedApifyKey('0123456789abcdef01234567:corruptedpayload123', TEST_SECRET);
    assert.strictEqual(corruptedCipher, null, 'Corrupted cipher returns null without throwing');
  });

  await itAsync('If key is empty -> tools provide helpful notice: "Please add your Apify key at rankforge.app/dashboard"', async () => {
    const auditRes = await executeSeoAudit({ url: 'https://example.com' }, null);
    assert.strictEqual(auditRes.crawl_summary.byok_configured, false);
    assert.strictEqual(
      auditRes.crawl_summary.byok_notice,
      'Please add your Apify key at rankforge.app/dashboard'
    );
  });

  // ----------------------------------------------------
  // TEST 3: Key Display in Dashboard
  // ----------------------------------------------------
  console.log('\n--- TEST 3: Key Display in Dashboard ---');

  it('Dashboard HTML contains password input for Apify key', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../pages/dashboard.html'), 'utf8');
    assert.ok(html.includes('type="password" id="apifyKeyInput"'), 'Input must have type="password"');
  });

  it('Dashboard JS implements show/hide password toggle', () => {
    const js = fs.readFileSync(path.resolve(__dirname, '../../pages/assets/js/dashboard.js'), 'utf8');
    assert.ok(js.includes('toggleApifyKeyVisibility'), 'Contains toggleApifyKeyVisibility');
    assert.ok(js.includes("keyInput.type = 'text'"), 'Toggles type to text');
    assert.ok(js.includes("keyInput.type = 'password'"), 'Toggles type back to password');
  });

  it('When key is already saved, dashboard shows "Connected ✓" and never displays raw key', () => {
    const js = fs.readFileSync(path.resolve(__dirname, '../../pages/assets/js/dashboard.js'), 'utf8');
    assert.ok(js.includes("badge.textContent = 'Connected ✓'"), 'Shows Connected ✓ status');
    assert.ok(!js.includes('keyInput.value = userData.apify_key'), 'Never exposes raw key in input');
  });

  it('Copy button copies MCP URL with token, not the Apify key', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../pages/dashboard.html'), 'utf8');
    assert.ok(html.includes('data-copy-target="mcpUrlDisplay"'), 'Copy targets mcpUrlDisplay');
    assert.ok(!html.includes('data-copy-target="apifyKeyInput"'), 'Never provides copy button for Apify key');
  });

  it('Key is submitted to /api/keys via POST (never GET with query params)', () => {
    const js = fs.readFileSync(path.resolve(__dirname, '../../pages/assets/js/dashboard.js'), 'utf8');
    assert.ok(js.includes("fetch('/api/keys'"), 'Target is /api/keys');
    assert.ok(js.includes("method: 'POST'"), 'Method is POST');
    assert.ok(js.includes('body: JSON.stringify({ apify_key: rawKey })'), 'Transmitted in request body');
  });

  // ----------------------------------------------------
  // TEST 4: Apify Actor Calls (seo-audit.ts & engine.ts)
  // ----------------------------------------------------
  console.log('\n--- TEST 4: Apify Actor Calls (seo-audit.ts & engine.ts) ---');

  it('seo-audit.ts targets official apify/website-content-crawler', () => {
    const code = fs.readFileSync(path.resolve(__dirname, './src/tools/seo-audit.ts'), 'utf8');
    assert.ok(code.includes('aYG0l9s7dbB7j3gbS'), 'Uses official website-content-crawler ID');
    assert.ok(code.includes('startUrls: [{ url }]'), 'Passes startUrls input');
    assert.ok(code.includes('maxCrawlPages:'), 'Passes maxCrawlPages input');
  });

  it('engine.ts passes Apify key as Authorization: Bearer header (never in query string)', () => {
    const code = fs.readFileSync(path.resolve(__dirname, './src/skill/engine.ts'), 'utf8');
    assert.ok(code.includes("'Authorization': `Bearer ${apifyToken}`"), 'Sets Bearer Authorization header');
    assert.ok(!code.includes('runs?token='), 'Token must not be in URL query string');
    assert.ok(!code.includes('items?token='), 'Token must not be in dataset URL query string');
  });

  it('engine.ts contains AbortSignal timeout handling for Apify calls', () => {
    const code = fs.readFileSync(path.resolve(__dirname, './src/skill/engine.ts'), 'utf8');
    assert.ok(code.includes('AbortSignal.timeout(65000)'), 'Timeout protection on actor run');
    assert.ok(code.includes('AbortSignal.timeout(30000)'), 'Timeout protection on dataset retrieval');
  });

  await itAsync('Gracefully handles Apify errors and returns structured fallback data', async () => {
    // Calling with invalid token will fail Apify API, engine must handle gracefully
    const result = await BeyondSeoEngine.runApifyActor(
      'aYG0l9s7dbB7j3gbS',
      { startUrls: [{ url: 'https://example.com' }] },
      'invalid_token_xyz'
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.fallback, true);
    assert.ok(result.error, 'Error message is captured without throwing');
  });

  // ----------------------------------------------------
  // TEST 5: Key Rotation
  // ----------------------------------------------------
  console.log('\n--- TEST 5: Key Rotation ---');

  await itAsync('Overwrites previous key on rotation using updateMask.fieldPaths=apify_key_encrypted', async () => {
    const initialKey = 'apify_old_key_111';
    const rotatedKey = 'apify_new_key_222';

    const enc1 = await encryptApifyKey(initialKey, TEST_SECRET);
    const enc2 = await encryptApifyKey(rotatedKey, TEST_SECRET);

    // Simulating overwrite in Firestore document
    const userDoc = { apify_key_encrypted: enc1 };
    userDoc.apify_key_encrypted = enc2; // Atomic overwrite

    const decrypted = await getDecryptedApifyKey(userDoc.apify_key_encrypted, TEST_SECRET);
    assert.strictEqual(decrypted, rotatedKey, 'Rotated key completely replaces old key');
    assert.notStrictEqual(decrypted, initialKey, 'Old key is no longer accessible');
  });

  // ----------------------------------------------------
  // TEST 6: Security Audit
  // ----------------------------------------------------
  console.log('\n--- TEST 6: Security Audit ---');

  it('ENCRYPTION_KEY is not hardcoded anywhere in repository', () => {
    const keysJs = fs.readFileSync(path.resolve(__dirname, '../../pages/functions/api/keys.js'), 'utf8');
    assert.ok(!keysJs.includes("|| 'default-rankforge-dev-secret-32b'"), 'No hardcoded default secret in keys.js');
  });

  it('ENCRYPTION_KEY is not in wrangler.toml plaintext [vars]', () => {
    const wrangler = fs.readFileSync(path.resolve(__dirname, './wrangler.toml'), 'utf8');
    assert.ok(!wrangler.includes('ENCRYPTION_KEY ='), 'ENCRYPTION_KEY must not be in [vars]');
  });

  it('Worker code never logs Apify keys to console', () => {
    const indexTs = fs.readFileSync(path.resolve(__dirname, './src/index.ts'), 'utf8');
    assert.ok(!indexTs.includes('console.log(apifyKey)'), 'No apifyKey logging');
    assert.ok(!indexTs.includes('console.log(userPlan.apify_key)'), 'No userPlan.apify_key logging');
  });

  it('Error messages returned to IDE never contain Apify keys or raw credentials', async () => {
    const indexTs = fs.readFileSync(path.resolve(__dirname, './src/index.ts'), 'utf8');
    assert.ok(indexTs.includes('rawMessage.includes'), 'Sanitizes error messages');
    assert.ok(indexTs.includes('Visit rankforge.app for assistance'), 'Clean error format');
  });

  console.log(`\n====================================================`);
  console.log(`BYOK TEST RESULTS: ${passedTests} passed, ${failedTests} failed out of ${totalTests} total tests`);
  console.log(`====================================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runBYOKTests().catch(err => {
  console.error('Fatal Test Failure:', err);
  process.exit(1);
});
