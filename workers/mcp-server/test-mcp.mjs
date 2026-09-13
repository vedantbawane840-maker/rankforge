import mod from './src/index.ts';
import { encryptApifyKey, getDecryptedApifyKey, enforcePlanLimits } from './src/plan-guard.ts';

const worker = mod.default || mod;

async function doRequest(path, init = {}, env = {}) {
  const url = path.startsWith('http') ? path : `http://localhost${path}`;
  const req = new Request(url, init);
  if (worker.fetch) {
    return await worker.fetch(req, env);
  }
  return await worker.request(path, init, env);
}

async function runTests() {
  console.log('--- Testing RankForge MCP Server & Plan Guard ---');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`✗ FAIL: ${message}`);
      failed++;
    }
  }

  const env = {
    ENCRYPTION_KEY: 'test-secret-key-for-aes-256-gcm-rankforge-01'
  };

  // Test 1: GET /mcp/health
  const healthRes = await doRequest('/mcp/health', {}, env);
  assert(healthRes.status === 200, 'GET /mcp/health status is 200');
  const healthJson = await healthRes.json();
  assert(healthJson.status === 'healthy' && healthJson.tools_count === 8, 'Health JSON has status healthy and 8 tools');

  // Test 2: GET /mcp/tools
  const toolsRes = await doRequest('/mcp/tools', {}, env);
  assert(toolsRes.status === 200, 'GET /mcp/tools status is 200');
  const toolsJson = await toolsRes.json();
  assert(toolsJson.tools?.length === 8, 'Tools list contains all 8 MCP tools');

  // Test 3: POST /mcp initialize
  const initRes = await doRequest('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize'
    })
  }, env);
  assert(initRes.status === 200, 'POST /mcp initialize status is 200');
  const initJson = await initRes.json();
  assert(initJson.result?.serverInfo?.name === 'rankforge-mcp', 'Initialize returned rankforge-mcp serverInfo');

  // Test 4: POST /mcp tools/list without auth (Should fail with -32001)
  const unauthRes = await doRequest('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'unauth-1',
      method: 'tools/list'
    })
  }, env);
  const unauthJson = await unauthRes.json();
  assert(unauthJson.error?.code === -32001, 'Unauthenticated tools/list correctly rejected with code -32001');

  // Test 5: POST /mcp tools/list with Bearer rf_dev_sandbox_token
  const authRes = await doRequest('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer rf_dev_sandbox_token'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'auth-1',
      method: 'tools/list'
    })
  }, env);
  const authJson = await authRes.json();
  assert(authJson.result?.tools?.length === 8, 'Authenticated tools/list returned 8 tools');

  // Test 6: POST /mcp tools/call for seo_audit
  const callRes = await doRequest('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer rf_dev_sandbox_token'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: 'seo_audit',
        arguments: {
          url: 'https://example.com',
          audit_type: 'quick'
        }
      }
    })
  }, env);
  const callJson = await callRes.json();
  assert(callJson.result?.content?.[0]?.type === 'text', 'Tool call returned valid MCP content block');
  const parsedToolOutput = JSON.parse(callJson.result.content[0].text);
  assert(parsedToolOutput.health_score?.total > 0, 'seo_audit calculated a positive health score');

  // Test 7: Direct Plan Guard enforcement check
  const guardRes = await enforcePlanLimits('rf_dev_sandbox_user', env);
  assert(guardRes.allowed === true, 'Plan guard allows request within limit');
  assert(typeof guardRes.remaining === 'number', 'Plan guard returns remaining audit count');

  // Test 8: AES-256-GCM encryption and decryption round-trip
  const secretKey = 'my-super-secret-production-encryption-key-123';
  const originalToken = 'apify_api_xyz987654321sampletoken';
  const encrypted = await encryptApifyKey(originalToken, secretKey);
  assert(encrypted.includes(':'), 'Encrypted token formatted as ivHex:cipherHex');
  const decrypted = await getDecryptedApifyKey(encrypted, secretKey);
  assert(decrypted === originalToken, 'Decrypted token matches original token exactly');

  // Test 9: Scheduled cron export is present
  assert(typeof worker.scheduled === 'function', 'Cloudflare Worker exports scheduled cron handler');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
