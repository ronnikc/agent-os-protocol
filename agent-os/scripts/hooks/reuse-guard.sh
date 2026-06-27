#!/usr/bin/env bash
# reuse-guard.sh — R-43 enforcement: blocks commits that introduce forbidden direct usage
# of infrastructure that must go through canonical services.
#
# Checks staged files for:
#   - Direct pdfkit / jsPDF import outside the export service directory
#   - Direct exceljs / adm-zip / docx import outside the export service directory
#   - Client-side CSV blob construction outside the export service directory
#   - console.log in backend files (should use createModuleLogger)
#   - Direct fetch() calls in frontend files (should use apiClient)
#
# Non-blocking on warnings; exits 1 only on hard violations.

set -euo pipefail

EXPORT_SERVICE_DIR="src/backend/src/services/export"
VIOLATIONS=()

# ── Helper ────────────────────────────────────────────────────────────────────
staged_ts_files() {
  git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' || true
}

check_pattern() {
  local label="$1"
  local pattern="$2"
  local exclude_path="$3"

  while IFS= read -r file; do
    # Skip the canonical export service directory
    if [[ "$file" == ${exclude_path}* ]]; then
      continue
    fi
    if git show ":$file" 2>/dev/null | grep -qE "$pattern"; then
      VIOLATIONS+=("$label in $file")
    fi
  done < <(staged_ts_files)
}

# ── 1. Forbidden export library imports outside export service ────────────────
check_pattern \
  "Direct pdfkit import (use UnifiedExportService — R-33/R-43)" \
  "from ['\"]pdfkit['\"]|require\(['\"]pdfkit['\"]" \
  "$EXPORT_SERVICE_DIR"

check_pattern \
  "Direct jsPDF import (use UnifiedExportService — R-33/R-43)" \
  "from ['\"]jspdf['\"]|require\(['\"]jspdf['\"]" \
  "$EXPORT_SERVICE_DIR"

check_pattern \
  "Direct exceljs import (use XlsxBuilder via UnifiedExportService — R-33/R-43)" \
  "from ['\"]exceljs['\"]|require\(['\"]exceljs['\"]" \
  "$EXPORT_SERVICE_DIR"

check_pattern \
  "Direct adm-zip import (use ZipBuilder via UnifiedExportService — R-33/R-43)" \
  "from ['\"]adm-zip['\"]|require\(['\"]adm-zip['\"]" \
  "$EXPORT_SERVICE_DIR"

check_pattern \
  "Direct docx import (use DocxBuilder via UnifiedExportService — R-33/R-43)" \
  "from ['\"]docx['\"]|require\(['\"]docx['\"]" \
  "$EXPORT_SERVICE_DIR"

# ── 2. Client-side CSV blob (frontend only) ───────────────────────────────────
while IFS= read -r file; do
  if [[ "$file" != src/frontend/* ]]; then continue; fi
  if git show ":$file" 2>/dev/null | grep -qE "new Blob\(\[.*\],\s*\{\s*type:\s*['\"]text/csv"; then
    VIOLATIONS+=("Client-side CSV Blob construction in $file (use UnifiedExportService — R-33/R-43)")
  fi
done < <(staged_ts_files)

# ── 3. Direct fetch() in frontend (should use apiClient) ─────────────────────
while IFS= read -r file; do
  if [[ "$file" != src/frontend/* ]]; then continue; fi
  # Allow fetch inside the api-client itself
  if [[ "$file" == *"api-client"* ]]; then continue; fi
  if git show ":$file" 2>/dev/null | grep -qE '^\s*(await\s+)?fetch\('; then
    VIOLATIONS+=("Direct fetch() call in $file (use apiClient — R-43; see REUSE.md §7)")
  fi
done < <(staged_ts_files)

# ── 4. console.log in backend files ──────────────────────────────────────────
while IFS= read -r file; do
  if [[ "$file" != src/backend/* ]]; then continue; fi
  if git show ":$file" 2>/dev/null | grep -qE '^\s*console\.(log|warn|error|info)\('; then
    VIOLATIONS+=("console.log in backend $file (use createModuleLogger — R-43; see REUSE.md §2)")
  fi
done < <(staged_ts_files)

# ── Report ────────────────────────────────────────────────────────────────────
if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  REUSE GUARD (R-43) — Violations found                      ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "The following staged changes bypass canonical reusable infrastructure."
  echo "Fix each violation before committing. See agent-os/REUSE.md for the"
  echo "correct component to use."
  echo ""
  for v in "${VIOLATIONS[@]}"; do
    echo "  ✗ $v"
  done
  echo ""
  exit 1
fi

echo "[reuse-guard] R-43 check passed — no forbidden direct-infrastructure usage detected."
exit 0
