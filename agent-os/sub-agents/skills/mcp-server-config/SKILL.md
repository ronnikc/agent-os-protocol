Title: MCP Server Configuration
Keywords: mcp-config, model-context-protocol, tool-registry, json-schemas, connector-setup
Agents: wordpress-specialist, drupal-specialist, joomla-specialist, umbraco-specialist, infrastructure
When to use: When writing, auditing, and configuring Model Context Protocol (MCP) server settings, tool schemas, and client connectors.
Version: 1.0.0
Last updated: 2026-06-30

Audit and configure Model Context Protocol (MCP) JSON settings files, tool registries, capabilities declarations, and client connector routes.

---

## Workflow

### Step 1 — Parse MCP Server Configuration
Load the target MCP server settings file (e.g. `mcp-settings.json` or native connector scripts). Extract the registry of exposed tools, prompt schemas, and service URLs.

### Step 2 — Validate Tool Schemas
Examine tool descriptor parameters:
- Assert that each tool specifies a unique `name` and a clear, descriptive `description`.
- Verify that input variables conform to JSON Schema parameters, declaring properties types and listing required keys.

### Step 3 — Secure Connector Endpoints
Verify client connection protocols:
- Assert that connections verify client access signatures or capability permissions (e.g. check keys in WordPress Settings > Connectors).
- Verify that tool execution callbacks are wrapped in strict exception handlers.

### Step 4 — Output Connector Verification Report
Compile tool counts, schemas verification, and connectivity details.

---

## Input Schema

```yaml
input:
  config_file_path:
    type: string
    required: true
    description: "Path to the MCP JSON configuration file to audit"
  mcp_spec_version:
    type: string
    required: false
    default: "2024-11-05"
    description: "The Model Context Protocol specification version"
```

## Output Schema

```yaml
output:
  validation:
    type: object
    properties:
      valid: { type: boolean }
      registered_tools: { type: integer }
  tools:
    type: array
    items:
      type: object
      properties:
        tool_name: { type: string }
        schema_valid: { type: boolean }
        security_restricted: { type: boolean }
```

## Quality Gate

- All registered tools declare explicit parameter types in their JSON schema
- Connector endpoints map to SSL/TLS secured routes
- Tool execution callbacks implement try-catch error traps

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "mcp-server-config"
  stage: "S1"
  suggested_next:
    - slug: "api-contract-validation"
      stage: "S1"
      reason: "MCP JSON tool payloads must conform to validated API schema contracts"
```

## Error Handling

- If the MCP config fails JSON validation, abort and report the formatting syntax error.
- If a tool specifies invalid JSON Schema keywords, reject the tool registration.
