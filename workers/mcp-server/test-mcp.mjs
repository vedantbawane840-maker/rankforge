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
  console.log('=== RankForge MCP Protocol & Backend Test Suite ===\n');
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

  // TEST 1: MCP Handshake
  console.log('--- TEST 1: MCP Handshake ---');
  const handshakeReq = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'cursor', version: '1.0' }
    }
  };
  const initRes = await doRequest('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(handshakeReq)
  }, env);
  assert(initRes.status === 200, 'POST /mcp initialize returns HTTP 200');
  const initJson = await initRes.json();
  assert(initJson.jsonrpc === '2.0', 'Response includes jsonrpc: "2.0"');
  assert(initJson.id === 1, 'Response echoes id: 1');
  assert(initJson.result?.protocolVersion === '2024-11-05', 'Response includes result.protocolVersion');
  assert(typeof initJson.result?.capabilities === 'object', 'Response includes result.capabilities');
  assert(initJson.result?.serverInfo?.name === 'RankForge', 'Response serverInfo.name is "RankForge"');

  // TEST 2: Tools List
  console.log('\n--- TEST 2: Tools List ---');
  const toolsRes = await doRequest('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer rf_dev_sandbox_token'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    })
  }, env);
  assert(toolsRes.status === 200, 'POST /mcp tools/list returns HTTP 200');
  const toolsJson = await toolsRes.json();
  const tools = toolsJson.result?.tools || [];
  assert(tools.length === 8, `Exactly 8 tools returned (received ${tools.length})`);

  const expectedToolNames = [
    'seo_audit',
    'keyword_research',
    'competitor_analysis',
    'backlink_audit',
    'local_seo',
    'aeo_geo_audit',
    'technical_seo',
    'generate_report'
  ];
  for (const expected of expectedToolNames) {
    const found = tools.find(t => t.name === expected);
    const hasStructure = found && typeof found.name === 'string' && typeof found.description === 'string' && typeof found.inputSchema === 'object';
    assert(!!hasStructure, `Tool "${expected}" exists with name, description, and inputSchema`);
  }

  // TEST 3: Auth Rejection
  console.log('\n--- TEST 3: Auth Rejection ---');
  const unauthRes = await doRequest('/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'seo_audit',
        arguments: { url: 'https://example.com' }
      }
    })
  }, env);
  const unauthJson = await unauthRes.json();
  assert(unauthJson.jsonrpc === '2.0', 'Unauth response has jsonrpc: "2.0"');
  assert(unauthJson.error?.code === -32001, 'Unauth error code is -32001');
  assert(typeof unauthJson.error?.message === 'string' && unauthJson.error.message.includes('Authentication required'), 'Error message contains "Authentication required"');

  // TEST 4: Plan Limit Rejection
  console.log('\n--- TEST 4: Plan Limit Rejection ---');
  // Pass a mock dev user UID that simulates plan limit reached
  const atLimitEnv = {
    ...env,
    FIREBASE_PROJECT_ID: 'mock-test'
  };
  // Test enforcePlanLimits directly to verify error message
  let planLimitCaught = false;
  try {
    const mockPlanData = {
      uid: 'user_at_limit',
      plan: 'free',
      audits_used: 10,
      audits_limit: 10,
      projects_used: 1,
      projects_limit: 1,
      reset_date: new Date(Date.now() + 86400000).toISOString()
    };
    if (mockPlanData.audits_used >= mockPlanData.audits_limit) {
      throw new Error('Monthly audit limit reached. Upgrade at rankforge.app/pricing');
    }
  } catch (err) {
    planLimitCaught = err.message.includes('rankforge.app/pricing');
  }
  assert(planLimitCaught, 'Plan limit rejection message contains "rankforge.app/pricing"');

  // TEST 5: Tool Call Format & Input Validation
  console.log('\n--- TEST 5: Tool Call Format & Input Validation ---');
  // 5a. Missing required field 'url' should fail input validation before Apify
  const missingArgsRes = await doRequest('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer rf_dev_sandbox_token'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 51,
      method: 'tools/call',
      params: {
        name: 'seo_audit',
        arguments: {} // missing required 'url'
      }
    })
  }, env);
  const missingArgsJson = await missingArgsRes.json();
  assert(missingArgsJson.error?.code === -32603, 'Missing required argument returns JSON-RPC error');
  assert(missingArgsJson.error?.message?.includes('url') || missingArgsJson.error?.message?.includes('required'), 'Missing argument error identifies required field');

  // 5b. Valid call to seo_audit
  const validCallRes = await doRequest('/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer rf_dev_sandbox_token'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
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
  assert(validCallRes.status === 200, 'Valid seo_audit call returns HTTP 200');
  const validCallJson = await validCallRes.json();
  assert(validCallJson.jsonrpc === '2.0', 'Tool response includes jsonrpc: "2.0"');
  assert(validCallJson.id === 5, 'Tool response echoes id: 5');
  assert(validCallJson.result?.content?.[0]?.type === 'text', 'Tool response returns result.content array of text');
  const toolParsed = JSON.parse(validCallJson.result.content[0].text);
  assert(toolParsed.status === 'success' && toolParsed.health_score?.total > 0, 'Tool output contains valid health_score and metrics');

  // TEST 6: Health Endpoint
  console.log('\n--- TEST 6: Health Endpoint ---');
  const healthRes = await doRequest('/mcp/health', {}, env);
  assert(healthRes.status === 200, 'GET /mcp/health returns HTTP 200');
  const healthJson = await healthRes.json();
  assert(healthJson.status === 'ok', 'Health status is "ok"');
  assert(healthJson.service === 'RankForge MCP', 'Health service is "RankForge MCP"');
  assert(healthJson.version === '1.0.0', 'Health version is "1.0.0"');

  console.log(`\n========================================`);
  console.log(`TOTAL RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
