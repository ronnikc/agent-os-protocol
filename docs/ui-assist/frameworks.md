<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen -->

# UI Assist — framework integration guides

These are the per-framework embeds the Integration Agent emits. They are also produced for your exact
project (paths, relay URL, lobby URL) by:

```bash
npm run ui-assist-integrate -- /path/to/app
```

Every snippet is **dev-gated** and the overlay opens **suggest-only** — see the safety model in
[`README.md`](README.md). In each case: start the bridge with `npm run relay`, serve
`packages/ui-assist-embed/embed.js` from your app, then add the snippet for your framework.

---

## Plain JS / static HTML

Before `</body>`, in your local/dev build only:

```html
<script type="module">
  import { mountUiAssist } from '/agent-os/ui-assist/embed.js';
  mountUiAssist({ relayUrl: 'ws://localhost:4722' });
</script>

<!-- …or auto-mount with no inline code: -->
<script type="module" src="/agent-os/ui-assist/embed.js" data-ui-assist-auto data-relay-url="ws://localhost:4722"></script>
```

## React

```jsx
// src/dev/UiAssistDev.jsx — never rendered in production builds.
import { useEffect } from 'react';

export function UiAssistDev() {
  useEffect(() => {
    if (import.meta.env && import.meta.env.PROD) return;
    let handle;
    import('/agent-os/ui-assist/embed.js').then(({ mountUiAssist }) => {
      handle = mountUiAssist({ relayUrl: 'ws://localhost:4722' });
    });
    return () => handle && handle.destroy && handle.destroy();
  }, []);
  return null;
}
```

Render `<UiAssistDev />` once near your app root (dev only).

## Next.js

```tsx
// components/UiAssistDev.tsx
'use client';
import { useEffect } from 'react';

export default function UiAssistDev() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    let handle: { destroy?: () => void } | undefined;
    import('/agent-os/ui-assist/embed.js').then(({ mountUiAssist }) => {
      handle = mountUiAssist({ relayUrl: 'ws://localhost:4722' });
    });
    return () => handle?.destroy?.();
  }, []);
  return null;
}
```

```tsx
// app/layout.tsx — load it client-side only
import dynamic from 'next/dynamic';
const UiAssistDev = dynamic(() => import('../components/UiAssistDev'), { ssr: false });

// …inside <body>, dev only:
{process.env.NODE_ENV !== 'production' && <UiAssistDev />}
```

Place `embed.js` under `/public` so it is served at `/agent-os/ui-assist/embed.js`.

## Vue

```js
// src/main.js (or main.ts) — dev only
if (import.meta.env.DEV) {
  import('/agent-os/ui-assist/embed.js').then(({ mountUiAssist }) => {
    mountUiAssist({ relayUrl: 'ws://localhost:4722' });
  });
}
```

## Svelte

```svelte
<!-- src/routes/+layout.svelte (or App.svelte) -->
<script>
  import { onMount } from 'svelte';
  onMount(async () => {
    if (import.meta.env.DEV) {
      const { mountUiAssist } = await import('/agent-os/ui-assist/embed.js');
      mountUiAssist({ relayUrl: 'ws://localhost:4722' });
    }
  });
</script>
```

## Laravel / Blade

Publish `embed.js` to `public/vendor/agent-os/embed.js`, then:

```blade
{{-- resources/views/partials/ui-assist.blade.php --}}
@env('local')
  <script type="module">
    import { mountUiAssist } from '{{ asset('vendor/agent-os/embed.js') }}';
    mountUiAssist({ relayUrl: 'ws://localhost:4722' });
  </script>
@endenv
```

Include it before `</body>` in your layout: `@include('partials.ui-assist')`.

## WordPress

Drop `embed.js` at `wp-content/mu-plugins/agent-os/embed.js`, then add the must-use plugin:

```php
<?php
// wp-content/mu-plugins/agent-os-ui-assist.php
// Loads UI Assist for administrators in debug builds only.
add_action('wp_enqueue_scripts', function () {
  if (!current_user_can('manage_options') || !(defined('WP_DEBUG') && WP_DEBUG)) return;
  $src = plugins_url('agent-os/embed.js', __FILE__);
  wp_enqueue_script('agent-os-ui-assist', $src, [], null, true);
  wp_script_add_data('agent-os-ui-assist', 'type', 'module');
  wp_add_inline_script(
    'agent-os-ui-assist',
    "import('".$src."').then(m => m.mountUiAssist({ relayUrl: 'ws://localhost:4722' }));",
    'after'
  );
});
```

## Joomla

Publish `embed.js` to `media/agent-os/embed.js`, then in your template:

```php
<?php // templates/<your-template>/index.php — before </body>, dev only
if (defined('JDEBUG') && JDEBUG) : ?>
<script type="module">
  import { mountUiAssist } from '/media/agent-os/embed.js';
  mountUiAssist({ relayUrl: 'ws://localhost:4722' });
</script>
<?php endif; ?>
```

---

## Secure connect & checks

For any framework, confirm:

- **Relay running** — `npm run relay` is up at `ws://localhost:4722` (its `/health` returns ok).
- **Embed served** — `embed.js` is reachable from the running app.
- **CSP** (if set) allows `script-src` the embed origin and `connect-src ws://localhost:4722` (and
  `wss:` for a lobby).
- **Dev-only** — the mount is gated to local/dev and never shipped to production.
- **Suggest-only** — the panel header shows "Suggest" until you explicitly grant act.

For Swarm Mode, point the relay at a lobby: `npm run relay -- --lobby wss://lobby.example.com` (the
overlay is unchanged; the bridge handles the lobby connection). No provider keys are sent to a lobby.
