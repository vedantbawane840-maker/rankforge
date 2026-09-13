/**
 * Beyond SEO Proprietary Server-Side Engine
 * Confidential: Never exposed directly to client AI coding agents.
 */

export interface HealthScoreResult {
  total: number; // 0 - 100
  breakdown: {
    technical: number; // /20
    onPage: number; // /15
    contentEEAT: number; // /20
    keywordArchitecture: number; // /15
    backlinks: number; // /10
    localSeo: number; // /10
    aeoGeo: number; // /5
    conversionTracking: number; // /5
  };
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
}

export interface PrioritizedIssue {
  issue: string;
  category: 'Technical' | 'On-Page' | 'Content' | 'Local' | 'Backlinks' | 'AEO' | 'Conversion';
  impact: number; // 1-5
  confidence: number; // 1-5
  effort: number; // 1-5
  risk: number; // 1-5
  score: number; // impact + confidence - effort - risk
  label: 'Must Fix Now' | 'High Impact Next' | 'Strategic Build' | 'Monitor' | 'Ignore for Now';
  action: string;
}

export interface QueryGrowthModel {
  targetQueriesPerMonth: number;
  assumedConversionRatePct: number;
  requiredMonthlyInteractions: number;
  channelBreakdown: {
    organicMoneyPages: number;
    localMapPackGbp: number;
    informationalClusters: number;
    croRecovery: number;
  };
  requiredAssets: {
    moneyPagesNeeded: number;
    supportArticlesNeeded: number;
    referringDomainsNeeded: number;
    gbpOptimizationsCount: number;
  };
  timelineWeeks: number;
  feasibilityRating: 'High' | 'Moderate' | 'Aggressive';
}

export class BeyondSeoEngine {
  /**
   * Calculates comprehensive 100-Point SEO Health Score.
   */
  static calculateHealthScore(signals: {
    crawlable: boolean;
    sslValid: boolean;
    brokenLinksCount: number;
    avgWordCount: number;
    hasSchema: boolean;
    mobileOptimized: boolean;
    metaMissingCount: number;
    h1MissingCount: number;
    internalLinksRatio: number;
    referringDomainsEst: number;
    gbpVerified?: boolean;
    directAnswerPresence?: boolean;
    ctaPresent: boolean;
  }): HealthScoreResult {
    let technical = 20;
    if (!signals.crawlable) technical -= 12;
    if (!signals.sslValid) technical -= 4;
    if (signals.brokenLinksCount > 0) technical -= Math.min(6, signals.brokenLinksCount * 2);
    if (!signals.mobileOptimized) technical -= 4;
    technical = Math.max(0, technical);

    let onPage = 15;
    if (signals.metaMissingCount > 0) onPage -= Math.min(5, signals.metaMissingCount * 2);
    if (signals.h1MissingCount > 0) onPage -= Math.min(5, signals.h1MissingCount * 2.5);
    if (signals.internalLinksRatio < 2) onPage -= 3;
    onPage = Math.max(0, onPage);

    let contentEEAT = 20;
    if (signals.avgWordCount < 600) contentEEAT -= 8;
    else if (signals.avgWordCount < 1000) contentEEAT -= 4;
    if (!signals.hasSchema) contentEEAT -= 4;
    contentEEAT = Math.max(0, contentEEAT);

    let keywordArch = 15;
    if (signals.avgWordCount < 500) keywordArch -= 5;
    keywordArch = Math.max(0, keywordArch);

    let backlinks = 10;
    if (signals.referringDomainsEst < 5) backlinks = 3;
    else if (signals.referringDomainsEst < 20) backlinks = 6;
    else backlinks = 9;

    let localSeo = 10;
    if (signals.gbpVerified === false) localSeo = 3;
    else if (signals.gbpVerified === true) localSeo = 9;
    else localSeo = 6;

    let aeoGeo = 5;
    if (signals.hasSchema && signals.directAnswerPresence) aeoGeo = 5;
    else if (signals.hasSchema || signals.directAnswerPresence) aeoGeo = 3;
    else aeoGeo = 1;

    let conversionTracking = 5;
    if (signals.ctaPresent) conversionTracking = 4;
    else conversionTracking = 1;

    const total =
      technical + onPage + contentEEAT + keywordArch + backlinks + localSeo + aeoGeo + conversionTracking;

    let grade: HealthScoreResult['grade'] = 'F';
    if (total >= 90) grade = 'A+';
    else if (total >= 80) grade = 'A';
    else if (total >= 70) grade = 'B';
    else if (total >= 60) grade = 'C';
    else if (total >= 50) grade = 'D';

    let summary = '';
    if (total >= 80) {
      summary = 'Solid baseline foundation with clear opportunities in topical clustering and AEO citation capture.';
    } else if (total >= 60) {
      summary = 'Moderate performance with notable structural gaps in on-page hierarchy, schema, and conversion paths.';
    } else {
      summary = 'Critical technical and content blockers detected that obstruct search bot indexing and organic ranking potential.';
    }

    return {
      total,
      breakdown: {
        technical,
        onPage,
        contentEEAT,
        keywordArchitecture: keywordArch,
        backlinks,
        localSeo,
        aeoGeo,
        conversionTracking
      },
      grade,
      summary
    };
  }

  /**
   * Prioritizes identified issues using the formula: Impact + Confidence - Effort - Risk.
   */
  static prioritizeIssues(rawIssues: Array<{
    issue: string;
    category: PrioritizedIssue['category'];
    impact: number;
    confidence: number;
    effort: number;
    risk: number;
    action: string;
  }>): PrioritizedIssue[] {
    return rawIssues
      .map(item => {
        const score = item.impact + item.confidence - item.effort - item.risk;
        let label: PrioritizedIssue['label'] = 'Ignore for Now';
        if (score >= 6) label = 'Must Fix Now';
        else if (score >= 4) label = 'High Impact Next';
        else if (score >= 2) label = 'Strategic Build';
        else if (score >= 0) label = 'Monitor';

        return {
          ...item,
          score,
          label
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Computes mathematical Query Growth Model for business queries/leads.
   */
  static generateQueryGrowthModel(
    targetQueries: number = 500,
    conversionRate: number = 7.5
  ): QueryGrowthModel {
    const rateDecimal = Math.max(0.01, conversionRate / 100);
    const requiredInteractions = Math.round(targetQueries / rateDecimal);

    const organicMoneyPages = Math.round(targetQueries * 0.45);
    const localMapPackGbp = Math.round(targetQueries * 0.30);
    const informationalClusters = Math.round(targetQueries * 0.15);
    const croRecovery = Math.round(targetQueries * 0.10);

    const moneyPagesNeeded = Math.max(3, Math.ceil(organicMoneyPages / 25));
    const supportArticlesNeeded = Math.max(6, moneyPagesNeeded * 2);
    const referringDomainsNeeded = Math.max(10, Math.ceil(targetQueries / 30));

    return {
      targetQueriesPerMonth: targetQueries,
      assumedConversionRatePct: conversionRate,
      requiredMonthlyInteractions: requiredInteractions,
      channelBreakdown: {
        organicMoneyPages,
        localMapPackGbp,
        informationalClusters,
        croRecovery
      },
      requiredAssets: {
        moneyPagesNeeded,
        supportArticlesNeeded,
        referringDomainsNeeded,
        gbpOptimizationsCount: 5
      },
      timelineWeeks: 12,
      feasibilityRating: targetQueries > 1000 ? 'Aggressive' : 'High'
    };
  }

  /**
   * Runs an Apify Actor run or returns synthetic intelligence if token is sandbox.
   */
  static async runApifyActor<T>(
    actorId: string,
    input: Record<string, unknown>,
    apifyToken: string | null
  ): Promise<{ success: boolean; data?: T[]; fallback?: boolean; error?: string }> {
    if (!apifyToken) {
      return { success: false, fallback: true };
    }

    try {
      const runUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${apifyToken}&waitForFinish=60`;
      const res = await fetch(runUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });

      if (!res.ok) {
        return { success: false, fallback: true, error: `Apify run status: ${res.status}` };
      }

      const runData = (await res.json()) as { data?: { defaultDatasetId?: string } };
      const datasetId = runData.data?.defaultDatasetId;
      if (!datasetId) {
        return { success: true, data: [] };
      }

      const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&limit=50`;
      const itemsRes = await fetch(datasetUrl);
      if (!itemsRes.ok) {
        return { success: true, data: [] };
      }

      const items = (await itemsRes.json()) as T[];
      return { success: true, data: items };
    } catch (e: unknown) {
      return { success: false, fallback: true, error: e instanceof Error ? e.message : 'Apify execution failed' };
    }
  }

  /**
   * Edge Native Crawl Fallback when live Apify key is pending or in sandbox.
   */
  static async nativeFetchPage(url: string): Promise<{
    html: string;
    status: number;
    title: string;
    metaDescription: string;
    h1: string[];
    wordCount: number;
    hasSchema: boolean;
    hasCta: boolean;
  }> {
    let html = '';
    let status = 200;

    try {
      const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
      const res = await fetch(parsedUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RankForgeBot/1.0; +https://rankforge.app)'
        }
      });
      status = res.status;
      html = await res.text();
    } catch {
      status = 500;
      html = '';
    }

    // Extract basic on-page signals
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i);
    const metaDescription = metaMatch ? metaMatch[1].trim() : '';

    const h1Matches = Array.from(html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)).map(m =>
      m[1].replace(/<[^>]*>/g, '').trim()
    );

    const cleanText = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                          .replace(/<style[\s\S]*?<\/style>/gi, '')
                          .replace(/<[^>]*>/g, ' ')
                          .replace(/\s+/g, ' ')
                          .trim();

    const wordCount = cleanText ? cleanText.split(' ').length : 0;
    const hasSchema = html.includes('application/ld+json');
    const hasCta = /book|schedule|contact|demo|sign up|get started|try now/i.test(html);

    return {
      html,
      status,
      title,
      metaDescription,
      h1: h1Matches,
      wordCount,
      hasSchema,
      hasCta
    };
  }
}
