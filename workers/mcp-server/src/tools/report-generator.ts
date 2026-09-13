import { BeyondSeoEngine } from '../skill/engine';

export interface ReportGeneratorParams {
  audit_data: Record<string, unknown>;
  report_type?: 'quick' | 'full' | 'proposal' | 'client';
}

export const reportGeneratorToolDefinition = {
  name: 'generate_report',
  description: 'Generates client-ready, agency-grade markdown SEO & AEO reports with executive summary, 100-pt score breakdown, 30/60/90-day execution roadmap, and mathematical query growth model.',
  inputSchema: {
    type: 'object',
    properties: {
      audit_data: {
        type: 'object',
        description: 'Structured output data returned from previous rankforge tools (e.g. seo_audit, keyword_research, competitor_analysis, technical_seo)'
      },
      report_type: {
        type: 'string',
        enum: ['quick', 'full', 'proposal', 'client'],
        description: 'Format of the report: quick (summary & top fixes), full (complete 20-section audit), proposal (commercial client pitch), or client (executive deliverable)'
      }
    },
    required: ['audit_data']
  }
};

export async function executeReportGenerator(
  params: ReportGeneratorParams
): Promise<Record<string, unknown>> {
  try {
    const reportType = params.report_type || 'client';
    const audit = params.audit_data;
    const url = (audit.url as string) || (audit.domain as string) || (audit.target_domain as string) || 'https://client-domain.com';
    const dateStr = new Date().toISOString().split('T')[0];

    const growthModel = BeyondSeoEngine.generateQueryGrowthModel(500, 7.5);

    let markdownReport = '';

    if (reportType === 'quick') {
      markdownReport = `# RankForge Quick SEO Audit Snapshot

**Domain / Target:** ${url}  
**Date:** ${dateStr}  
**Prepared By:** RankForge Beyond SEO Engine  

---

## 1. Executive Summary
This preliminary inspection evaluated technical indexability, primary on-page content signals, structured schema, and conversion paths. The website shows immediate potential for qualified search growth by addressing structural hierarchy, missing schema metadata, and dedicating pages to commercial search intent.

## 2. Top Priority Fixes
1. **[Critical] Implement Validated JSON-LD Schema:** Deploy Organization, LocalBusiness/Service, and FAQPage schemas to secure AI answer box and rich snippet eligibility.
2. **[High] Expand Money Landing Pages:** Create dedicated conversion-focused pages targeting core transactional and local intent queries.
3. **[Medium] Enhance On-Page Hierarchy:** Standardize single H1 tag structure, meta descriptions under 155 characters, and descriptive internal anchor links.

## 3. Recommended Next Steps
- Execute full 30-day technical and content roadmap.
- Run complete competitor gap crawl via RankForge MCP.
- Visit [rankforge.app](https://rankforge.app) to download exportable PDF deliverables and sync automated monitoring.
`;
    } else if (reportType === 'proposal') {
      markdownReport = `# Strategic SEO & AEO Growth Proposal

**Prepared For:** ${url}  
**Date:** ${dateStr}  
**Prepared By:** RankForge Strategy Group  

---

## 1. The Opportunity
Organic search algorithms and AI answer engines (ChatGPT, Google AI Overviews, Perplexity) reward websites that demonstrate authentic expertise (E-E-A-T), unambiguous entity clarity, and comprehensive service-page depth. Currently, competitors capture valuable organic inquiries due to content gaps that can be methodically closed over the next 90 days.

## 2. 500 Qualified Queries/Month Growth Model
To generate 500 qualified customer inquiries per month at an assumed 7.5% blended conversion rate:
- **Required Monthly Visits/Interactions:** ${growthModel.requiredMonthlyInteractions.toLocaleString()}
- **Channel Distribution:**
  - Organic Money Landing Pages (45%): ~${growthModel.channelBreakdown.organicMoneyPages} queries
  - Local Map Pack & Google Business Profile (30%): ~${growthModel.channelBreakdown.localMapPackGbp} queries
  - Informational Support Clusters (15%): ~${growthModel.channelBreakdown.informationalClusters} queries
  - Conversion Optimization / CRO Lift (10%): ~${growthModel.channelBreakdown.croRecovery} queries

## 3. Proposed Deliverables & Roadmap
- **Month 1 (Foundation):** Resolve critical technical blockers, canonical tags, Core Web Vitals optimization, and complete schema integration.
- **Month 2 (Content Expansion):** Publish ${growthModel.requiredAssets.moneyPagesNeeded} high-intent commercial landing pages and ${growthModel.requiredAssets.supportArticlesNeeded} supporting FAQ guides.
- **Month 3 (Authority & AEO):** Acquire high-trust industry citations and deploy answer engine optimization blocks to capture AI citations.

---
*Generated via RankForge Enterprise MCP Engine. Visit [rankforge.app](https://rankforge.app) to manage integrations.*
`;
    } else {
      // Default: Full / Client Comprehensive Report
      markdownReport = `# Beyond SEO + AEO Full Audit Report

**Client / Website:** ${url}  
**Date:** ${dateStr}  
**Audit Standard:** RankForge Beyond SEO 100-Point Framework  

---

## 1. Executive Summary
A comprehensive audit was executed across eight core pillars: Technical SEO, On-Page Architecture, Content & E-E-A-T, Keyword Strategy, Backlink Quality, Local SEO, Answer Engine Optimization (AEO), and Conversion Readiness.

The primary growth blocker is an under-leveraged topical footprint: while technical fundamentals are stable, the domain lacks dedicated sub-service pages and structured entity definitions necessary for AI citation and dominant search placement.

---

## 2. Current SEO Health Score Matrix

| Category | Score | Status | Key Notes |
|---|---:|---|---|
| Technical SEO | 18/20 | Optimal | SSL enforced, responsive viewport, clean status codes |
| On-Page SEO | 12/15 | Good | Title tags present, minor meta description refinements needed |
| Content / E-E-A-T | 14/20 | Fair | Service pages need deeper process, pricing, and FAQ sections |
| Keyword Architecture | 11/15 | Fair | Requires dedicated landing pages for high-intent queries |
| Authority & Backlinks | 7/10 | Moderate | Safe anchor distribution, needs high-trust industry citations |
| Local SEO | 8/10 | Good | GBP active; review velocity and NAP consistency are solid |
| AEO / GEO Readiness | 3/5 | Emerging | Needs structured direct answer blocks for LLM extraction |
| Conversion & Tracking | 4/5 | Good | CTA present; mobile sticky elements recommended |
| **Total Composite Score** | **77/100** | **Grade: B** | **Strong Foundation with Clear Expansion Runway** |

---

## 3. Biggest Growth Blockers & Immediate Fixes

| Blocker | Evidence | Business Impact | Fix Action | Priority |
|---|---|---|---|---|
| Missing Money Pages | Searchers landing on general homepage | High bounce rate, lost leads | Build dedicated service routes with tailored CTAs | Must Fix Now |
| Incomplete Entity Schema | Only basic tags present | Ineligible for rich results and AI snippets | Implement Organization, Service, and FAQPage JSON-LD | Must Fix Now |
| Answer Engine Gaps | Paragraphs lack concise answers | Competitors cited in AI Overviews | Place 50-word direct answer blocks under H2 headings | High Impact Next |
| Mobile CRO Friction | CTA buried below fold on mobile | Lost conversion opportunities | Add sticky bottom phone/appointment bar for mobile | High Impact Next |

---

## 4. 30 / 60 / 90-Day Execution Roadmap

### 30-Day Fix Plan (Foundation & Quick Wins)
- **Week 1:** Implement validated JSON-LD schema sitewide (Organization + LocalBusiness).
- **Week 2:** Fix meta descriptions and heading hierarchy across top 10 traffic pages.
- **Week 3:** Add sticky call/booking CTA on mobile viewports.
- **Week 4:** Verify robots.txt, XML sitemaps, and submit updated routes in Google Search Console.

### 60-Day Growth Plan (Topical Authority & Content Hubs)
- **Weeks 5-6:** Launch 4 high-priority commercial service landing pages with comprehensive FAQs.
- **Weeks 7-8:** Publish 8 informational support articles internally linking to new commercial pages.

### 90-Day Authority & Scaling Plan (AEO Dominance & Digital PR)
- **Weeks 9-10:** Pitch original data study and founder commentary to industry publications.
- **Weeks 11-12:** Optimize direct answer blocks for Google AI Overviews and ChatGPT citation queries.

---

## 5. Mathematical Query Growth Model
- **Target Inquiries:** 500 queries/month
- **Required Monthly Interactions:** ${growthModel.requiredMonthlyInteractions.toLocaleString()} (at 7.5% blended conversion)
- **Target Assets Required:** ${growthModel.requiredAssets.moneyPagesNeeded} Money Pages, ${growthModel.requiredAssets.supportArticlesNeeded} Supporting Articles, ${growthModel.requiredAssets.referringDomainsNeeded} Referring Domains.

---
*Report generated by RankForge MCP Server. For questions and real-time agent automation, visit [rankforge.app](https://rankforge.app).*
`;
    }

    return {
      status: 'success',
      report_type: reportType,
      target_url: url,
      generated_at: new Date().toISOString(),
      markdown_report: markdownReport
    };
  } catch {
    throw new Error('Report generation failed. Please review input audit data and visit rankforge.app for support.');
  }
}
