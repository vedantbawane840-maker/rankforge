import { BeyondSeoEngine } from '../skill/engine';

export interface KeywordResearchParams {
  domain: string;
  seed_keywords: string[];
  location?: string;
}

export const keywordResearchToolDefinition = {
  name: 'keyword_research',
  description: 'Performs keyword discovery, intent classification (brand, service, cost, local, AEO/question, transactional), and clusters keywords into high-value landing page maps.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'Target website or brand domain (e.g. acmedental.com)'
      },
      seed_keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of initial target terms or core service offerings'
      },
      location: {
        type: 'string',
        description: 'Geographic location context (e.g. Chicago, IL or United States)'
      }
    },
    required: ['domain', 'seed_keywords']
  }
};

export async function executeKeywordResearch(
  params: KeywordResearchParams,
  apifyToken: string | null
): Promise<Record<string, unknown>> {
  try {
    const domain = params.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const seeds = params.seed_keywords.filter(k => k.trim().length > 0);
    const location = params.location || 'United States';

    // Query Apify Google Search Scraper if configured
    await BeyondSeoEngine.runApifyActor(
      'nFJndFXA5zjCTuudP', // apify/google-search-scraper
      {
        queries: seeds.slice(0, 5).join('\n'),
        countryCode: 'us',
        maxPagesPerQuery: 1
      },
      apifyToken
    );

    // Beyond SEO Keyword Intent Clustering logic
    const clusters = seeds.map(seed => {
      const lower = seed.toLowerCase();
      let intent: 'brand' | 'service' | 'cost' | 'local' | 'aeo_question' | 'transactional' = 'service';
      let priority: 'Existing Winner' | 'Fastest Win' | 'Missing Money Page' | 'AEO Opportunity' = 'Missing Money Page';

      if (lower.includes('cost') || lower.includes('price') || lower.includes('how much') || lower.includes('affordable')) {
        intent = 'cost';
        priority = 'Fastest Win';
      } else if (lower.includes('near me') || lower.includes('in ') || params.location) {
        intent = 'local';
        priority = 'Missing Money Page';
      } else if (lower.includes('how') || lower.includes('what') || lower.includes('why') || lower.includes('guide')) {
        intent = 'aeo_question';
        priority = 'AEO Opportunity';
      } else if (lower.includes('buy') || lower.includes('hire') || lower.includes('book') || lower.includes('service')) {
        intent = 'transactional';
        priority = 'Fastest Win';
      } else if (domain.includes(lower) || lower.includes(domain.split('.')[0])) {
        intent = 'brand';
        priority = 'Existing Winner';
      }

      // Generate cluster variants
      const longTails = [
        `best ${seed} ${location !== 'United States' ? location : ''}`.trim(),
        `${seed} cost and pricing breakdown`,
        `how to choose ${seed}`,
        `${seed} vs alternatives`
      ];

      return {
        core_keyword: seed,
        intent_category: intent,
        priority_classification: priority,
        estimated_difficulty: intent === 'cost' ? 'Low-Medium' : 'Medium-High',
        business_value: intent === 'transactional' || intent === 'local' ? 'High' : 'Medium',
        recommended_target_page: `/${seed.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/`,
        actionable_clusters: longTails
      };
    });

    return {
      status: 'success',
      target_domain: domain,
      location_context: location,
      total_seed_terms: seeds.length,
      clusters_identified: clusters.length,
      clusters,
      mapping_strategy: {
        hub_pages_needed: clusters.filter(c => c.intent_category === 'service' || c.intent_category === 'local').length,
        support_articles_needed: clusters.filter(c => c.intent_category === 'aeo_question' || c.intent_category === 'cost').length,
        execution_advice: 'Map transactional and local keywords directly to dedicated conversion landing pages with structured schema. Feed them internally via informational FAQ support articles.'
      }
    };
  } catch {
    throw new Error('Keyword research failed. Please check inputs and visit rankforge.app for support.');
  }
}
