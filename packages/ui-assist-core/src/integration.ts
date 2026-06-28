// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

/**
 * Integration engine — the deterministic core the Integration Agent drives to embed the overlay
 * into a developer's own app (IMPLEMENTATION-PLAN.md §12). It (1) detects the project type from a
 * file/dependency inventory and (2) emits a framework-appropriate integration plan: the embed
 * snippet, install/health checks, and the secure-connect summary.
 *
 * Pure and dependency-free — no filesystem, no network — so it verifies in Node over fixtures and
 * stays safe to reuse anywhere. A thin CLI (`agent-os/scripts/ui-assist-integrate.ts`) supplies the
 * real-project inventory; the agent reasons over the plan this returns.
 *
 * Safety is baked into every plan: the snippet is **dev-gated**, the overlay mounts **suggest-only**,
 * and the connection targets a **local** relay (or an explicit lobby URL) — never a hard-coded
 * remote, never a project edit without consent.
 */

export type FrameworkTarget =
  | 'next'
  | 'react'
  | 'vue'
  | 'svelte'
  | 'laravel'
  | 'wordpress'
  | 'joomla'
  | 'plain';

export interface ProjectInventory {
  /** Relative file paths present in the project (any representative subset). */
  files: string[];
  /** Merged dependency names from package.json (deps + devDeps), lower-cased, if known. */
  dependencies?: string[];
  /** composer.json "require" package names (PHP projects), if known. */
  composer?: string[];
}

export interface DetectionResult {
  framework: FrameworkTarget;
  confidence: 'high' | 'medium' | 'low';
  /** Human-readable reasons the framework was chosen. */
  signals: string[];
}

/**
 * Detect the project's framework from an inventory. PHP ecosystems are checked first, then JS with
 * Next.js taking precedence over plain React (Next implies React). Falls back to the plain-JS embed.
 */
export function detectProjectType(inv: ProjectInventory): DetectionResult {
  const files = (inv.files ?? []).map((f) => f.replace(/\\/g, '/'));
  const deps = new Set((inv.dependencies ?? []).map((d) => d.toLowerCase()));
  const composer = new Set((inv.composer ?? []).map((d) => d.toLowerCase()));
  const hasFile = (re: RegExp) => files.some((f) => re.test(f));

  // ── PHP ecosystems (distinct from the JS toolchain) ──
  if (composer.has('laravel/framework') || hasFile(/(^|\/)artisan$/) || hasFile(/\.blade\.php$/)) {
    const signals: string[] = [];
    if (composer.has('laravel/framework')) signals.push('composer requires laravel/framework');
    if (hasFile(/(^|\/)artisan$/)) signals.push('artisan present');
    if (hasFile(/\.blade\.php$/)) signals.push('*.blade.php views present');
    return { framework: 'laravel', confidence: 'high', signals };
  }
  if (hasFile(/(^|\/)wp-config\.php$/) || hasFile(/(^|\/)wp-load\.php$/) || hasFile(/(^|\/)wp-content\//)) {
    return { framework: 'wordpress', confidence: 'high', signals: ['WordPress core files (wp-config.php / wp-content/)'] };
  }
  if (
    hasFile(/administrator\/manifests\/files\/joomla\.xml$/) ||
    (hasFile(/(^|\/)configuration\.php$/) && hasFile(/(^|\/)administrator\//))
  ) {
    return { framework: 'joomla', confidence: 'high', signals: ['Joomla manifest / configuration.php + administrator/'] };
  }

  // ── JS frameworks (Next before React) ──
  if (deps.has('next') || hasFile(/(^|\/)next\.config\.(js|ts|mjs|cjs)$/)) {
    return { framework: 'next', confidence: 'high', signals: [deps.has('next') ? 'dependency: next' : 'next.config present'] };
  }
  if (deps.has('svelte') || hasFile(/(^|\/)svelte\.config\.(js|ts|mjs|cjs)$/) || hasFile(/\.svelte$/)) {
    return { framework: 'svelte', confidence: deps.has('svelte') ? 'high' : 'medium', signals: ['Svelte detected'] };
  }
  if (deps.has('vue') || hasFile(/(^|\/)vue\.config\.(js|ts|mjs|cjs)$/) || hasFile(/\.vue$/)) {
    return { framework: 'vue', confidence: deps.has('vue') ? 'high' : 'medium', signals: ['Vue detected'] };
  }
  if (deps.has('react') || deps.has('react-dom')) {
    return { framework: 'react', confidence: 'high', signals: ['dependency: react'] };
  }

  return {
    framework: 'plain',
    confidence: 'low',
    signals: [hasFile(/\.html?$/) ? 'static HTML, no framework markers' : 'no framework markers — using the plain-JS embed'],
  };
}

export interface IntegrationOptions {
  /** Local relay URL the overlay connects to. Default ws://localhost:4722. */
  relayUrl?: string;
  /** Optional remote lobby URL (Swarm Mode) — used in the connect notes only. */
  lobbyUrl?: string;
  /** Where the app serves embed.js from. Default '/agent-os/ui-assist/embed.js'. */
  embedSrc?: string;
}

export interface IntegrationPlan {
  framework: FrameworkTarget;
  displayName: string;
  /** Ordered, human-readable integration steps. */
  steps: string[];
  /** Code to add, one block per file/insertion point. */
  snippets: Array<{ label: string; language: string; code: string }>;
  /** Install / health checks to confirm the wiring. */
  checks: string[];
  /** Secure-connect summary. */
  connect: { relayUrl: string; lobbyUrl?: string; notes: string[] };
}

const DISPLAY_NAMES: Record<FrameworkTarget, string> = {
  next: 'Next.js',
  react: 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  laravel: 'Laravel / Blade',
  wordpress: 'WordPress',
  joomla: 'Joomla',
  plain: 'Plain JS / static HTML',
};

function commonChecks(o: Required<Pick<IntegrationOptions, 'relayUrl' | 'embedSrc'>>): string[] {
  return [
    `Relay running: \`npm run relay\` is up and reachable at ${o.relayUrl} (GET its /health returns ok).`,
    `Embed served: ${o.embedSrc} is reachable from the running app (copied from packages/ui-assist-embed/embed.js).`,
    `CSP (if any) allows: script-src the embed origin; connect-src ${o.relayUrl} (and wss: for a lobby).`,
    'Dev-only: the mount is gated to local/dev builds and not shipped to production.',
    'Suggest-only on open: the panel header shows "Suggest" until you explicitly grant act.',
  ];
}

function commonConnect(o: Required<Pick<IntegrationOptions, 'relayUrl'>> & { lobbyUrl?: string }): IntegrationPlan['connect'] {
  const notes = [
    'The overlay connects to your local relay; the relay bridges to your agent runtime.',
    'Suggest-only by default — UI Assist cannot edit the project until you grant edit/commit authority.',
    'No provider keys are sent to a lobby; BYOK keys stay local (see docs/providers).',
  ];
  if (o.lobbyUrl) notes.push(`Swarm Mode: point the relay at the lobby (\`npm run relay -- --lobby ${o.lobbyUrl}\`).`);
  return { relayUrl: o.relayUrl, lobbyUrl: o.lobbyUrl, notes };
}

/** Build the framework-specific integration plan. */
export function emitIntegrationPlan(framework: FrameworkTarget, options: IntegrationOptions = {}): IntegrationPlan {
  const relayUrl = options.relayUrl ?? 'ws://localhost:4722';
  const embedSrc = options.embedSrc ?? '/agent-os/ui-assist/embed.js';
  const o = { relayUrl, embedSrc };
  const base = {
    framework,
    displayName: DISPLAY_NAMES[framework],
    checks: commonChecks(o),
    connect: commonConnect({ relayUrl, lobbyUrl: options.lobbyUrl }),
  };

  switch (framework) {
    case 'plain':
      return {
        ...base,
        steps: [
          `Copy packages/ui-assist-embed/embed.js into your static assets (served at ${embedSrc}).`,
          'Add the module script before </body> in your local/dev build only.',
        ],
        snippets: [
          {
            label: 'index.html (dev only) — before </body>',
            language: 'html',
            code: `<script type="module">\n  import { mountUiAssist } from '${embedSrc}';\n  mountUiAssist({ relayUrl: '${relayUrl}' });\n</script>\n\n<!-- or auto-mount with no inline code: -->\n<script type="module" src="${embedSrc}" data-ui-assist-auto data-relay-url="${relayUrl}"></script>`,
          },
        ],
      };

    case 'react':
      return {
        ...base,
        steps: [
          `Serve embed.js from your public assets at ${embedSrc}.`,
          'Add a dev-only component that dynamically imports the embed and mounts it.',
          'Render <UiAssistDev /> once near your app root.',
        ],
        snippets: [
          {
            label: 'src/dev/UiAssistDev.jsx',
            language: 'jsx',
            code: `import { useEffect } from 'react';\n\n// Dev-only overlay — never rendered in production builds.\nexport function UiAssistDev() {\n  useEffect(() => {\n    if (import.meta.env && import.meta.env.PROD) return;\n    let handle;\n    import('${embedSrc}').then(({ mountUiAssist }) => {\n      handle = mountUiAssist({ relayUrl: '${relayUrl}' });\n    });\n    return () => handle && handle.destroy && handle.destroy();\n  }, []);\n  return null;\n}`,
          },
        ],
      };

    case 'next':
      return {
        ...base,
        steps: [
          `Place embed.js under /public so it is served at ${embedSrc}.`,
          "Add a client component ('use client') that mounts the overlay in dev only.",
          'Load it with next/dynamic ({ ssr: false }) in your root layout.',
        ],
        snippets: [
          {
            label: 'components/UiAssistDev.tsx',
            language: 'tsx',
            code: `'use client';\nimport { useEffect } from 'react';\n\nexport default function UiAssistDev() {\n  useEffect(() => {\n    if (process.env.NODE_ENV === 'production') return;\n    let handle: { destroy?: () => void } | undefined;\n    import('${embedSrc}').then(({ mountUiAssist }) => {\n      handle = mountUiAssist({ relayUrl: '${relayUrl}' });\n    });\n    return () => handle?.destroy?.();\n  }, []);\n  return null;\n}`,
          },
          {
            label: 'app/layout.tsx — load it client-side only',
            language: 'tsx',
            code: `import dynamic from 'next/dynamic';\nconst UiAssistDev = dynamic(() => import('../components/UiAssistDev'), { ssr: false });\n\n// …inside <body>, dev only:\n{process.env.NODE_ENV !== 'production' && <UiAssistDev />}`,
          },
        ],
      };

    case 'vue':
      return {
        ...base,
        steps: [
          `Serve embed.js at ${embedSrc} (e.g. from /public).`,
          'Mount the overlay from your entry (main.js/ts), gated to dev.',
        ],
        snippets: [
          {
            label: 'src/main.js (or main.ts)',
            language: 'js',
            code: `// Dev-only UI Assist overlay\nif (import.meta.env.DEV) {\n  import('${embedSrc}').then(({ mountUiAssist }) => {\n    mountUiAssist({ relayUrl: '${relayUrl}' });\n  });\n}`,
          },
        ],
      };

    case 'svelte':
      return {
        ...base,
        steps: [
          `Serve embed.js at ${embedSrc} (e.g. from /static).`,
          'Mount it from your root layout/App with onMount, gated to dev.',
        ],
        snippets: [
          {
            label: 'src/routes/+layout.svelte (or App.svelte)',
            language: 'svelte',
            code: `<script>\n  import { onMount } from 'svelte';\n  onMount(async () => {\n    if (import.meta.env.DEV) {\n      const { mountUiAssist } = await import('${embedSrc}');\n      mountUiAssist({ relayUrl: '${relayUrl}' });\n    }\n  });\n</script>`,
          },
        ],
      };

    case 'laravel':
      return {
        ...base,
        steps: [
          'Publish embed.js to public/vendor/agent-os/embed.js.',
          'Add a Blade partial gated to the local environment.',
          "Include it before </body> in your layout: @include('partials.ui-assist').",
        ],
        snippets: [
          {
            label: 'resources/views/partials/ui-assist.blade.php',
            language: 'blade',
            code: `@env('local')\n  <script type="module">\n    import { mountUiAssist } from '{{ asset('vendor/agent-os/embed.js') }}';\n    mountUiAssist({ relayUrl: '${relayUrl}' });\n  </script>\n@endenv`,
          },
        ],
      };

    case 'wordpress':
      return {
        ...base,
        steps: [
          'Drop embed.js next to a must-use plugin: wp-content/mu-plugins/agent-os/embed.js.',
          'Add the mu-plugin below; it loads the overlay for admins when WP_DEBUG is on.',
        ],
        snippets: [
          {
            label: 'wp-content/mu-plugins/agent-os-ui-assist.php',
            language: 'php',
            code: `<?php\n// Loads UI Assist for administrators in debug builds only.\nadd_action('wp_enqueue_scripts', function () {\n  if (!current_user_can('manage_options') || !(defined('WP_DEBUG') && WP_DEBUG)) return;\n  $src = plugins_url('agent-os/embed.js', __FILE__);\n  wp_enqueue_script('agent-os-ui-assist', $src, [], null, true);\n  wp_script_add_data('agent-os-ui-assist', 'type', 'module');\n  wp_add_inline_script(\n    'agent-os-ui-assist',\n    "import('".$src."').then(m => m.mountUiAssist({ relayUrl: '${relayUrl}' }));",\n    'after'\n  );\n});`,
          },
        ],
      };

    case 'joomla':
      return {
        ...base,
        steps: [
          'Publish embed.js to media/agent-os/embed.js.',
          'Add a dev-gated module script to your template (index.php), shown only when Joomla debug is on.',
        ],
        snippets: [
          {
            label: 'templates/<your-template>/index.php — before </body>',
            language: 'php',
            code: `<?php if (defined('JDEBUG') && JDEBUG) : ?>\n<script type="module">\n  import { mountUiAssist } from '/media/agent-os/embed.js';\n  mountUiAssist({ relayUrl: '${relayUrl}' });\n</script>\n<?php endif; ?>`,
          },
        ],
      };
  }
}

/** Convenience: detect + plan in one call. */
export function planIntegration(inv: ProjectInventory, options: IntegrationOptions = {}): { detection: DetectionResult; plan: IntegrationPlan } {
  const detection = detectProjectType(inv);
  return { detection, plan: emitIntegrationPlan(detection.framework, options) };
}

/** All supported targets — handy for guides and exhaustive checks. */
export const FRAMEWORK_TARGETS: FrameworkTarget[] = ['plain', 'react', 'next', 'vue', 'svelte', 'laravel', 'wordpress', 'joomla'];
