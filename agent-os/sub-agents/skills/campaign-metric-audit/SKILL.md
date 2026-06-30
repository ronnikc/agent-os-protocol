Title: Campaign Metric Auditing
Keywords: campaign-audit, analytics-pixels, conversion-rates, cpc-tracking, marketing-metrics
Agents: ad-campaign-manager, newsletter-strategist, comms-specialist
When to use: When auditing marketing conversion pixels, calculating customer acquisition costs (CAC), and verifying CPC/ROAS metrics.
Version: 1.0.0
Last updated: 2026-06-30

Audit advertising conversion tracking codes, campaign URLs, and calculate marketing performance metrics (ROAS, CAC, CPC).

---

## Workflow

### Step 1 — Verify Pixel Integration
Examine page HTML/JS files to check that analytics tracking scripts (e.g. Google Analytics, Meta Pixel) are correctly configured:
- Assert that pixel scripts load asynchronously to avoid blocking page rendering.
- Verify that tracking events (e.g. signup, purchase, bid-submitted) trigger on correct user actions.

### Step 2 — Audit UTM Parameters
Verify that campaign links contain standardized UTM codes (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`) to prevent attribution losses.

### Step 3 — Calculate Acquisition Ratios
Compute marketing efficiency metrics using current data sheets:
- **CPC (Cost Per Click):** `Total Spend / Total Clicks`
- **ROAS (Return on Ad Spend):** `Campaign Revenue / Campaign Cost`
- **CAC (Customer Acquisition Cost):** `Total Spend / Total Acquired Clients`

### Step 4 — Produce Performance Critique
Generate a structured audit report summarizing attribution gaps, invalid pixel events, and spending efficiency.

---

## Input Schema

```yaml
input:
  campaign_spend:
    type: number
    required: true
    description: "Total budget spent on the campaign in currency units"
  acquired_leads:
    type: integer
    required: true
    description: "Total number of leads/acquisitions generated"
  revenue_generated:
    type: number
    required: false
    default: 0
    description: "Total campaign revenue generated"
```

## Output Schema

```yaml
output:
  metrics:
    type: object
    properties:
      cac: { type: number }
      roas: { type: number }
      efficiency_rating: { type: enum, values: [High, Normal, Low] }
  warnings:
    type: array
    items: string
```

## Quality Gate

- Conversion pixel events trigger only upon verified user success actions
- Campaign URLs include all 4 mandatory UTM parameters
- Acquisition costs (CAC) do not exceed target budget constraints

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "campaign-metric-audit"
  stage: "S4"
  suggested_next:
    - slug: "performance-optimization"
      stage: "S4"
      reason: "Optimize landing pages to lower bounce rates and improve conversion metrics"
```

## Error Handling

- If spend is zero but leads are generated, flag the metric anomaly as an attribution tracking error.
- If conversion pixels are blocked by browser CSP headers, suggest Helmet policy adjustments.
