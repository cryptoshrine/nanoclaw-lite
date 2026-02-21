// ── Web Research for Council Admirals ────────────────────────────────
// Provides web search capability so admirals can ground their proposals
// in real-world data. Uses a pre-research phase before the debate begins.

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchBundle {
  query: string;
  results: SearchResult[];
  timestamp: string;
}

// ── Brave Search API (free tier: 2000 queries/month) ────────────────

async function braveSearch(query: string, count = 5): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  // If no Brave API key, fall back to Google Custom Search or return empty
  if (!apiKey) {
    return googleSearch(query, count);
  }

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
      {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
      },
    );

    if (!res.ok) {
      console.warn(`Brave Search API error ${res.status}, falling back to Google`);
      return googleSearch(query, count);
    }

    const data = (await res.json()) as {
      web?: { results?: { title: string; url: string; description: string }[] };
    };

    return (
      data.web?.results?.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      })) || []
    );
  } catch (err) {
    console.warn('Brave Search failed:', err);
    return googleSearch(query, count);
  }
}

// ── Google Custom Search Fallback ───────────────────────────────────

async function googleSearch(query: string, count = 5): Promise<SearchResult[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;

  // If no Google Search config, return empty results with a note
  if (!apiKey || !cx) {
    return [];
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=${count}`,
    );

    if (!res.ok) return [];

    const data = (await res.json()) as {
      items?: { title: string; link: string; snippet: string }[];
    };

    return (
      data.items?.map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet,
      })) || []
    );
  } catch {
    return [];
  }
}

// ── Research Phase ──────────────────────────────────────────────────
// Generates search queries from the topic, runs them, and compiles
// a research brief that gets injected into the admiral prompts.

function generateSearchQueries(topic: string): string[] {
  // Extract key concepts from the topic for search queries
  // We generate 3-5 focused queries from the topic
  const queries: string[] = [];

  // Primary: the topic itself (truncated for search)
  const truncated = topic.length > 150 ? topic.slice(0, 150) : topic;
  queries.push(truncated);

  // Try to extract actionable keywords for more targeted searches
  const keywords = topic
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 8);

  if (keywords.length >= 3) {
    // Technical search
    queries.push(`${keywords.slice(0, 4).join(' ')} implementation best practices 2026`);
    // Industry/market search
    queries.push(`${keywords.slice(0, 3).join(' ')} market trends analysis`);
  }

  return queries.slice(0, 4); // Max 4 queries
}

export async function conductResearch(topic: string): Promise<ResearchBundle[]> {
  const queries = generateSearchQueries(topic);
  const bundles: ResearchBundle[] = [];

  for (const query of queries) {
    try {
      const results = await braveSearch(query, 5);
      bundles.push({
        query,
        results,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(`Search failed for query "${query}":`, err);
    }
  }

  return bundles;
}

export function formatResearchBrief(bundles: ResearchBundle[]): string {
  if (bundles.length === 0 || bundles.every((b) => b.results.length === 0)) {
    return '';
  }

  const sections = bundles
    .filter((b) => b.results.length > 0)
    .map((b) => {
      const results = b.results
        .map(
          (r, i) =>
            `  [${i + 1}] "${r.title}"\n      URL: ${r.url}\n      ${r.snippet}`,
        )
        .join('\n');
      return `Query: "${b.query}"\n${results}`;
    })
    .join('\n\n');

  return `
RESEARCH BRIEFING (web search results):
The following research was gathered before the deliberation. Use these sources
to ground your proposals in real-world data. When citing information from these
results, reference them by [source_N] where N is the number shown.

${sections}

CITATION RULES:
- You may ONLY cite URLs that appear in the research briefing above
- Reference sources as [source_N] in your text
- Do NOT fabricate or hallucinate URLs or sources
- If the research doesn't cover something, say "no source available" rather than inventing one
`;
}

// ── Citation Extraction ─────────────────────────────────────────────

export function extractCitations(content: string): string[] {
  const urlRegex = /https?:\/\/[^\s\])"']+/g;
  const matches = content.match(urlRegex) || [];
  return [...new Set(matches)]; // Deduplicate
}

export function getValidSourceUrls(bundles: ResearchBundle[]): Set<string> {
  const urls = new Set<string>();
  for (const bundle of bundles) {
    for (const result of bundle.results) {
      urls.add(result.url);
      // Also add domain-level matches for flexibility
      try {
        const domain = new URL(result.url).hostname;
        urls.add(domain);
      } catch { /* skip malformed URLs */ }
    }
  }
  return urls;
}
