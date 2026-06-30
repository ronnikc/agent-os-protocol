Title: Structured Data Analysis
Keywords: data-analysis, csv-parsing, structured-reports, database-querying, telemetry-aggregation
Agents: research, database-administrator, planning
When to use: When parsing tabular files (CSV, JSON, XML), filtering log databases, and generating data reports.
Version: 1.0.0
Last updated: 2026-06-30

Parse, filter, aggregate, and compile structured data from logs, CSV files, database records, and JSON datasets to create telemetry reports.

---

## Workflow

### Step 1 — Load Dataset File
Open and load the structured dataset file (e.g. log dump, CSV sheet, or JSON output).

### Step 2 — Parse and Filter Records
Scan records and filter based on query constraints:
- Filter out duplicate logs or blank rows.
- Filter records matching specific parameters (e.g. status error flags, API durations over 500ms).

### Step 3 — Aggregate Performance Metrics
Calculate summary calculations:
- Group records by component or route code.
- Calculate averages (e.g. average execution time, total errors, cost rates).

### Step 4 — Compile Summary Report
Format aggregated metrics as Markdown tables or structured reports with clear indicators.

---

## Input Schema

```yaml
input:
  data_file_path:
    type: string
    required: true
    description: "Path to the dataset or log file to parse"
  filter_parameter:
    type: string
    required: false
    description: "Key-value pair filter (e.g. status=error)"
```

## Output Schema

```yaml
output:
  data_report:
    type: object
    properties:
      total_rows_parsed: { type: integer }
      matches_found: { type: integer }
      report_markdown: { type: string }
```

## Quality Gate

- Zero raw duplicate rows exist in filtered metrics
- Averages are calculated correctly, omitting blank or malformed data points
- Report markdown contains no unclosed tables or syntax issues

## Chain Metadata

```yaml
chain_metadata:
  skill_slug: "structured-data-analysis"
  stage: "S2"
  suggested_next:
    - slug: "root-cause-debugging"
      stage: "S3"
      reason: "Aggregated error logs must be investigated to trace system crash paths"
```

## Error Handling

- If the dataset file is unreadable or uses invalid syntax, abort and return a file load error.
- If data size exceeds memory constraints, process files in chunked streams.
