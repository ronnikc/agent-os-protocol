Title: Deployment Verification
Keywords: deployment, docker, health-check, security-headers, CORS, monitoring
Agents: infrastructure
When to use: When verifying deployment readiness or troubleshooting production environment issues.
Version: 1.0.0
Last updated: 2026-03-10

Verify deployment readiness: Docker build, health check endpoints, security headers (Helmet CSP/HSTS), CORS configuration, pino logging, and environment variables. Used before releases and when diagnosing production issues.

---

## Verification Checklist

### 1. Docker build

```bash
docker-compose build
docker-compose up -d
```

### 2. Health checks

```bash
curl -s http://localhost:3000/health | jq .
# Expected: { "status": "ok", "timestamp": "...", "uptime": ... }
```

### 3. Security headers

Verify Helmet is configured:
- Content-Security-Policy header present
- Strict-Transport-Security header present
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY or SAMEORIGIN

### 4. CORS

Verify allowed origins match deployment environment. No wildcard (*) in production.

### 5. Logging

Verify pino structured logging is active. Check log output format is JSON.

### 6. Environment variables

All required env vars documented and set. No secrets hardcoded in source.

### 7. Background jobs

Verify scheduled jobs are registered and running (if applicable).

## Input Schema

```yaml
input:
  environment:
    type: string
    required: true
    enum: ["local", "staging", "production"]
    description: "Target deployment environment to verify"
  base_url:
    type: string
    required: true
    description: "Base URL of the deployed application (e.g., http://localhost:3000)"
  checks:
    type: array
    items: string
    required: false
    default: ["docker", "health", "security-headers", "cors", "logging", "env-vars"]
    description: "Which deployment checks to run"
```

## Output Schema

```yaml
output:
  deployment_report:
    type: object
    description: "Deployment verification results"
    properties:
      environment:
        type: string
      base_url:
        type: string
      checks:
        type: array
        items:
          type: object
          properties:
            name: string
            result: "pass | fail | warn"
            details: string
      overall_status:
        type: "ready | not-ready"
      blocking_issues:
        type: array
        items: string
```

## Quality Gate

- Docker build completes successfully and containers start without errors.
- Health check endpoint returns expected JSON response with status "ok".
- All required security headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options) are present and correctly configured.
- No wildcard CORS origins are configured in production environment.

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "deployment-verification"
  stage: "S5"
  suggested_next:
    - slug: "runtime-verification"
      stage: "S3"
      reason: "Run runtime verification to confirm build and test health before final release"
    - slug: "sprint-gate-enforcement"
      stage: "S2"
      reason: "Complete sprint close-out gates after deployment verification passes"
```

## Error Handling

- If Docker build fails, capture the build log and report the specific stage and error before proceeding with other checks.
- If the health check endpoint is unreachable, verify that containers are running and ports are correctly mapped before reporting a deployment failure.
- If security headers are missing, identify which Helmet configuration is absent and provide the specific configuration fix needed.
