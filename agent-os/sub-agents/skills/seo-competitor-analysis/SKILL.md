Title: SEO Competitor Analysis
Keywords: serp-audit, competitor-keywords, metadata-optimization, search-ranking
Agents: seo, seo-link-architect, ad-campaign-manager
When to use: When auditing organic competitor landing pages, comparing metadata tags, and designing search queries keywords.
Version: 1.0.0
Last updated: 2026-06-30

Analyze competitor Search Engine Results Page (SERP) metadata structures, content lengths, and keyword targets to optimize landing page rankings.

---

## Workflow

### Step 1 — Fetch Competitor Metadata
Perform searches on target keywords to identify top competitor landing pages. Retrieve:
- **Title tags** and **Meta descriptions**
- **Header structures** (H1, H2, H3 distributions)
- **Schema.org markup** specifications (e.g. Product, Article, Organization)

### Step 2 — Compare Keyword Density
Analyze competitor page content lengths, keyword occurrences, and semantic density. Identify gaps where secondary keywords are missing on your own landing page.

### Step 3 — Design Layout Recommendations
Create recommendations to optimize page performance:
- Draft compelling, length-compliant title tags (maximum 60 characters) and meta descriptions (maximum 160 characters).
- Suggest structured schema markups to enable rich snippets.

### Step 4 — Compile Competitor Report
Generate a summary comparing competitor metadata metrics against your page performance.

---

## Input Schema

```yaml
input:
  target_keywords:
    type: array
    items: string
    required: true
    description: "Keywords list to query search results for"
  competitor_urls:
    type: array
    items: string
    required: false
    description: "Specific competitor URLs to audit directly"
```

## Output Schema

```yaml
output:
  ranking_analysis:
    type: object
    properties:
      keyword_gaps: { type: array, items: string }
      target_title_suggestion: { type: string }
      target_description_suggestion: { type: string }
```

## Quality Gate

- Title recommendations are strictly 60 characters or less
- Meta descriptions are strictly 160 characters or less
- Suggested titles include the primary target keyword

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "seo-competitor-analysis"
  stage: "S4"
  suggested_next:
    - slug: "seo-link-architect"
      stage: "S4"
      reason: "Optimized metadata must be supported by organic competitor backlinks analysis"
```

## Error Handling

- If competitor pages block scraper requests, audit search engine cache snippets instead.
- If keywords yield zero competitor results, expand query parameters to include broader terms.
