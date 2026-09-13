import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verifyAuthToken, WorkerEnv, AuthUser } from './auth';
import { enforcePlanLimits, PlanGuardResult, getDecryptedApifyKey, UserPlanData } from './plan-guard';
import { handleMonthlyReset } from './cron';

import { seoAuditToolDefinition, executeSeoAudit, SeoAuditParams } from './tools/seo-audit';
import { keywordResearchToolDefinition, executeKeywordResearch, KeywordResearchParams } from './tools/keyword-research';
import { competitorAnalysisToolDefinition, executeCompetitorAnalysis, CompetitorAnalysisParams } from './tools/competitor-analysis';
import { backlinkAuditToolDefinition, executeBacklinkAudit, BacklinkAuditParams } from './tools/backlink-audit';
import { localSeoToolDefinition, executeLocalSeo, LocalSeoParams } from './tools/local-seo';
import { aeoGeoAuditToolDefinition, executeAeoGeoAudit, AeoGeoAuditParams } from './tools/aeo-geo';
import { technicalAuditToolDefinition, executeTechnicalAudit, TechnicalAuditParams } from './tools/technical-audit';
import { reportGeneratorToolDefinition, executeReportGenerator, ReportGeneratorParams } from './tools/report-generator';

const app = new Hono<{ Bindings: WorkerEnv }>();

// Enable CORS for web/dashboard clients and external IDEs
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  allowMethods: ['GET', 'POST', 'OPTIONS']
}));

// Complete list of MCP tools
const ALL_TOOLS = [
  seoAuditToolDefinition,
  keywordResearchToolDefinition,
  competitorAnalysisToolDefinition,
  backlinkAuditToolDefinition,
  localSeoToolDefinition,
  aeoGeoAuditToolDefinition,
  technicalAuditToolDefinition,
  reportGeneratorToolDefinition
];

/**
 * Health check endpoint
 */
app.get('/mcp/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'RankForge MCP',
    version: '1.0.0',
    protocol: 'JSON-RPC 2.0 / MCP',
    timestamp: new Date().toISOString(),
    tools_count: ALL_TOOLS.length
  });
});

/**
 * Tools list endpoint for inspection and GET discovery
 */
app.get('/mcp/tools', (c) => {
  return c.json({
    tools: ALL_TOOLS
  });
});

/**
 * Main MCP JSON-RPC 2.0 Endpoint
 */
app.post('/mcp', async (c) => {
  let body: {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error: Malformed JSON body. Visit rankforge.app for MCP setup instructions.'
      }
    }, 400);
  }

  const { id = null, method, params = {} } = body;

  // Validate JSON-RPC version
  if (body.jsonrpc !== '2.0' || !method) {
    return c.json({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32600,
        message: 'Invalid Request: jsonrpc must be "2.0" and method must be specified. Visit rankforge.app for docs.'
      }
    }, 400);
  }

  // Handle standard MCP lifecycle methods that don't require full auth (or perform lightweight handshake)
  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {
            listChanged: false
          }
        },
        serverInfo: {
          name: 'RankForge',
          version: '1.0.0'
        }
      }
    });
  }

  if (method === 'notifications/initialized') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {}
    });
  }

  if (method === 'ping') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {}
    });
  }

  // Auth flow: verify Bearer token on tool listings and executions
  const authHeader = c.req.header('Authorization');
  let authUser: AuthUser;

  try {
    authUser = await verifyAuthToken(authHeader, c.env);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Authentication required. Visit rankforge.app to get your MCP URL.';
    return c.json({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32001,
        message: errorMsg,
        data: {
          help: 'https://rankforge.app/docs'
        }
      }
    }, 401);
  }

  // Handle tools/list
  if (method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: ALL_TOOLS
      }
    });
  }

  // Handle tools/call
  if (method === 'tools/call') {
    const toolName = (params.name as string) || '';
    const toolArgs = (params.arguments as Record<string, unknown>) || {};

    // 1. Enforce Plan Limits in Firestore
    let guardResult: PlanGuardResult;
    try {
      guardResult = await enforcePlanLimits(authUser.uid, c.env);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Monthly audit limit reached. Upgrade at rankforge.app/pricing';
      return c.json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32002,
          message: errorMsg,
          data: {
            upgrade_url: 'https://rankforge.app/pricing'
          }
        }
      });
    }

    const userPlan = guardResult.user;

    // 2. Decrypt user's BYOK Apify key (never logged)
    const apifyKey = await getDecryptedApifyKey(userPlan.apify_key, c.env.ENCRYPTION_KEY);

    // 3. Dispatch to appropriate tool
    try {
      let toolResult: Record<string, unknown>;

      switch (toolName) {
        case 'seo_audit': {
          toolResult = await executeSeoAudit(toolArgs as unknown as SeoAuditParams, apifyKey);
          break;
        }
        case 'keyword_research': {
          toolResult = await executeKeywordResearch(toolArgs as unknown as KeywordResearchParams, apifyKey);
          break;
        }
        case 'competitor_analysis': {
          toolResult = await executeCompetitorAnalysis(toolArgs as unknown as CompetitorAnalysisParams, apifyKey);
          break;
        }
        case 'backlink_audit': {
          toolResult = await executeBacklinkAudit(toolArgs as unknown as BacklinkAuditParams, apifyKey);
          break;
        }
        case 'local_seo': {
          toolResult = await executeLocalSeo(toolArgs as unknown as LocalSeoParams, apifyKey);
          break;
        }
        case 'aeo_geo_audit': {
          toolResult = await executeAeoGeoAudit(toolArgs as unknown as AeoGeoAuditParams, apifyKey);
          break;
        }
        case 'technical_seo': {
          toolResult = await executeTechnicalAudit(toolArgs as unknown as TechnicalAuditParams, apifyKey);
          break;
        }
        case 'generate_report': {
          toolResult = await executeReportGenerator(toolArgs as unknown as ReportGeneratorParams);
          break;
        }
        default:
          return c.json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: Tool "${toolName}" is not registered in RankForge MCP. Visit rankforge.app/docs for available tools.`
            }
          });
      }

      // Return standard MCP tool call response
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(toolResult, null, 2)
            }
          ]
        }
      });
    } catch (err: unknown) {
      // Catch internal errors and sanitize message
      const rawMessage = err instanceof Error ? err.message : 'Tool execution error';
      const cleanMessage = rawMessage.includes('Visit rankforge.app')
        ? rawMessage
        : `Tool execution failed: ${rawMessage}. Visit rankforge.app for assistance.`;

      return c.json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: cleanMessage,
          data: {
            tool: toolName,
            help: 'https://rankforge.app'
          }
        }
      });
    }
  }

  // Unhandled method
  return c.json({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: "${method}". Supported MCP methods: initialize, ping, tools/list, tools/call. Visit rankforge.app for docs.`
    }
  });
});

export default {
  fetch: app.fetch,
  scheduled: handleMonthlyReset
};
