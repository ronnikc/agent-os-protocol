/**
 * Files Tab — Browse and edit agent-os/ files with markdown preview.
 * Left panel: directory tree (lazy-loaded). Right panel: file editor + preview.
 * Restricted to agent-os/ directory only (server enforces path security).
 */
import { fetchJson, putJson, registerTab, escapeHtml, hostedSession, lobbyApi } from '../app.js';

// In hosted mode the Files tab browses the lobby's CONNECTED GitHub repo (read-only) via the
// wallet-gated /repo endpoints, instead of the local agent-os/ filesystem. Direct edits from here
// aren't wired yet — hosted agents land changes as commits/PRs (a later slice).

let currentPath = '';
let currentContent = '';
let currentFileName = '';
let isEditing = false;
let showPreview = false;
let expandedDirs = new Set(['']); // root is expanded by default
let dirCache = new Map(); // path → entries

// ── Simple Markdown Renderer (no dependencies) ──
function renderMarkdown(md) {
  // Normalize line endings (Windows \r\n → \n) — critical for all regex patterns
  md = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Extract code blocks BEFORE escaping (they contain raw chars like < > &)
  const codeBlocks = [];
  let text = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre style="background:var(--bg-surface);padding:10px;border-radius:4px;overflow-x:auto;font-size:12px;white-space:pre;"><code>${escapeHtml(code)}</code></pre>`);
    return `%%CODEBLOCK_${idx}%%`;
  });
  // Extract inline code before escaping
  const inlineCodes = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code style="background:var(--bg-surface);padding:2px 5px;border-radius:3px;font-size:12px;">${escapeHtml(code)}</code>`);
    return `%%INLINE_${idx}%%`;
  });

  let html = escapeHtml(text);
  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4 style="margin:16px 0 8px;font-size:14px;">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 style="margin:16px 0 8px;font-size:15px;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="margin:20px 0 10px;font-size:17px;border-bottom:1px solid var(--border);padding-bottom:6px;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="margin:20px 0 10px;font-size:20px;">$1</h1>');
  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--accent);" target="_blank">$1</a>');
  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, '<li style="margin-left:20px;">$1</li>');
  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:20px;">$1</li>');
  // Blockquotes (escaped >)
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:3px solid var(--accent);padding-left:12px;color:var(--text-secondary);margin:8px 0;">$1</blockquote>');
  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:16px 0;">');
  // Markdown tables → HTML tables
  const lines = html.split('\n');
  let inTable = false;
  const processed = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) {
        inTable = true;
        processed.push('<table style="width:100%;border-collapse:collapse;font-size:12px;margin:8px 0;">');
      }
      if (/^\|[\s\-:|]+\|$/.test(line)) continue;
      const cells = line.split('|').filter(c => c.trim() !== '');
      const nextLine = lines[i + 1]?.trim() || '';
      const isHeader = !inTable || /^\|[\s\-:|]+\|$/.test(nextLine);
      const tag = isHeader ? 'th' : 'td';
      processed.push('<tr>' + cells.map(c => `<${tag} style="padding:4px 10px;border:1px solid var(--border);text-align:left;">${c.trim()}</${tag}>`).join('') + '</tr>');
    } else {
      if (inTable) { inTable = false; processed.push('</table>'); }
      processed.push(line);
    }
  }
  if (inTable) processed.push('</table>');
  html = processed.join('\n');

  // Restore code blocks BEFORE paragraph processing (pre inside p is invalid HTML)
  for (let i = 0; i < codeBlocks.length; i++) {
    html = html.replace(`%%CODEBLOCK_${i}%%`, `\n${codeBlocks[i]}\n`);
  }
  for (let i = 0; i < inlineCodes.length; i++) {
    html = html.replace(`%%INLINE_${i}%%`, inlineCodes[i]);
  }

  // Split into blocks: code blocks stay as-is, text gets paragraph treatment
  const blocks = html.split(/(<pre[\s\S]*?<\/pre>)/);
  html = blocks.map(block => {
    if (block.startsWith('<pre')) return block; // code blocks untouched
    // Remove blank lines between block-level elements (blockquotes, headings, lists, tables, hrs)
    block = block.replace(/(<\/blockquote>|<\/h[1-4]>|<\/li>|<\/table>|<hr[^>]*>|<\/div>)\n{1,}(<blockquote|<h[1-4]|<li|<table|<hr|<div)/g, '$1$2');
    // Convert remaining double newlines to paragraph breaks
    block = block.replace(/\n{2,}/g, '</div><div style="margin:6px 0;">');
    // Single newlines to <br> (but not between block elements)
    block = block.replace(/\n/g, '<br>');
    // Clean up <br> immediately after/before block elements
    block = block.replace(/<br>(<blockquote|<h[1-4]|<li|<table|<hr|<div|<\/div>)/g, '$1');
    block = block.replace(/(<\/blockquote>|<\/h[1-4]>|<\/li>|<\/table>|<\/div>)<br>/g, '$1');
    return `<div style="margin:4px 0;">${block}</div>`;
  }).join('');

  return html;
}

// ── Syntax Highlighter (no dependencies) ──
function highlightSyntax(code, fileName) {
  const ext = (fileName.match(/\.(\w+)$/)?.[1] || '').toLowerCase();
  let html = escapeHtml(code);

  // Color definitions (CSS custom properties from our dark theme)
  const S = 'color:#a5d6ff';   // strings — light blue
  const K = 'color:#ff7b72';   // keywords — red/orange
  const C = 'color:#8b949e';   // comments — gray
  const N = 'color:#79c0ff';   // numbers — blue
  const F = 'color:#d2a8ff';   // functions — purple
  const T = 'color:#7ee787';   // types — green
  const P = 'color:#ffa657';   // properties/attributes — orange

  // Apply patterns based on file type
  if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
    // Comments (must come first to avoid double-highlighting)
    html = html.replace(/(\/\/[^\n]*)/g, `<span style="${C}">$1</span>`);
    html = html.replace(/(\/\*[\s\S]*?\*\/)/g, `<span style="${C}">$1</span>`);
    // Strings (single, double, backtick)
    html = html.replace(/(&apos;[^&]*?&apos;|&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|'[^']*?'|"[^"]*?")/g, `<span style="${S}">$1</span>`);
    // Keywords
    html = html.replace(/\b(import|export|from|const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|class|extends|implements|interface|type|enum|async|await|try|catch|finally|throw|typeof|instanceof|void|null|undefined|true|false|default|as|in|of)\b/g, `<span style="${K}">$1</span>`);
    // Types
    html = html.replace(/\b(string|number|boolean|any|never|unknown|Record|Map|Set|Array|Promise|Partial|Required|Readonly)\b/g, `<span style="${T}">$1</span>`);
    // Numbers
    html = html.replace(/\b(\d+\.?\d*)\b/g, `<span style="${N}">$1</span>`);
  } else if (ext === 'css') {
    html = html.replace(/(\/\*[\s\S]*?\*\/)/g, `<span style="${C}">$1</span>`);
    html = html.replace(/(#[a-fA-F0-9]{3,8})\b/g, `<span style="${N}">$1</span>`);
    html = html.replace(/\b(\d+\.?\d*(px|em|rem|%|vh|vw|s|ms)?)\b/g, `<span style="${N}">$1</span>`);
    html = html.replace(/([\w-]+)\s*(?=:)/g, `<span style="${P}">$1</span>`);
  } else if (ext === 'html') {
    html = html.replace(/(&lt;!--[\s\S]*?--&gt;)/g, `<span style="${C}">$1</span>`);
    html = html.replace(/(&lt;\/?)([\w-]+)/g, `$1<span style="${K}">$2</span>`);
    html = html.replace(/([\w-]+)(=)/g, `<span style="${P}">$1</span>$2`);
  } else if (ext === 'json') {
    html = html.replace(/(&quot;[^&]*?&quot;|"[^"]*?")\s*(?=:)/g, `<span style="${P}">$1</span>`);
    html = html.replace(/:\s*(&quot;[^&]*?&quot;|"[^"]*?")/g, `: <span style="${S}">$1</span>`);
    html = html.replace(/\b(true|false|null)\b/g, `<span style="${K}">$1</span>`);
    html = html.replace(/\b(\d+\.?\d*)\b/g, `<span style="${N}">$1</span>`);
  } else if (ext === 'sh') {
    html = html.replace(/(#[^\n]*)/g, `<span style="${C}">$1</span>`);
    html = html.replace(/\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|echo|export|local|readonly|set|unset|source)\b/g, `<span style="${K}">$1</span>`);
    html = html.replace(/(&quot;[^&]*?&quot;|"[^"]*?")/g, `<span style="${S}">$1</span>`);
    html = html.replace(/(\$\{?[\w]+\}?)/g, `<span style="${F}">$1</span>`);
  }

  return html;
}

// ── Directory Tree ──
async function loadDir(path) {
  if (dirCache.has(path)) return dirCache.get(path);
  const s = hostedSession();
  if (s) {
    const data = await lobbyApi(`/lobbies/${s.lobbyId}/repo/tree?path=${encodeURIComponent(path)}`);
    if (data && data.error) {
      const errObj = { error: data.error };
      dirCache.set(path, errObj);
      return errObj;
    }
    const entries = (data?.entries || []).map((e) => ({ name: String(e.path).split('/').pop(), type: e.type === 'dir' ? 'directory' : 'file' }));
    dirCache.set(path, entries);
    return entries;
  }
  const data = await fetchJson(`/api/files?path=${encodeURIComponent(path)}`);
  if (data?.type === 'directory') {
    dirCache.set(path, data.entries);
    return data.entries;
  }
  return [];
}

function renderTreeNode(entry, parentPath) {
  const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.type === 'directory') {
    const isExpanded = expandedDirs.has(fullPath);
    return `<div class="tree-node">
      <div class="tree-item tree-dir ${isExpanded ? 'expanded' : ''}" data-path="${escapeHtml(fullPath)}" data-type="dir">
        <span class="tree-arrow">${isExpanded ? '▾' : '▸'}</span>
        <span class="tree-icon">📁</span>
        <span>${escapeHtml(entry.name)}</span>
      </div>
      ${isExpanded ? `<div class="tree-children" id="tree-${escapeHtml(fullPath).replace(/[/.]/g, '_')}"></div>` : ''}
    </div>`;
  }
  const icon = entry.name.endsWith('.md') ? '📄' : entry.name.endsWith('.json') ? '📋' : entry.name.endsWith('.ts') || entry.name.endsWith('.js') ? '📜' : entry.name.endsWith('.sh') ? '⚙️' : '📄';
  const isActive = fullPath === currentPath;
  return `<div class="tree-node">
    <div class="tree-item tree-file ${isActive ? 'active' : ''}" data-path="${escapeHtml(fullPath)}" data-type="file">
      <span class="tree-arrow" style="visibility:hidden">▸</span>
      <span class="tree-icon">${icon}</span>
      <span>${escapeHtml(entry.name)}</span>
    </div>
  </div>`;
}

async function renderTree(path, container) {
  const entries = await loadDir(path);
  if (entries && entries.error) {
    container.innerHTML = `
      <div style="padding:16px;color:var(--color-text-soft);font-size:12px;line-height:1.5;">
        <span style="font-size:14px;font-weight:600;display:block;margin-bottom:8px;color:var(--color-text);">🐙 GitHub Not Connected</span>
        No GitHub repository is connected to this lobby.
        <div style="margin-top:12px;">
          To connect your repository:
          <ol style="margin:6px 0 0 16px;padding:0;">
            <li>Go to the <strong style="color:var(--color-text);cursor:pointer;text-decoration:underline;" onclick="document.querySelector('button[data-tab=\\'lobby\\']').click()">Lobby</strong> tab</li>
            <li>Scroll down to <strong>Integrations</strong></li>
            <li>Connect your GitHub App and select your repository</li>
          </ol>
        </div>
      </div>
    `;
    return;
  }
  if (!entries?.length) {
    container.innerHTML = '<div style="padding:4px 20px;color:var(--text-muted);font-size:11px;">(empty)</div>';
    return;
  }
  container.innerHTML = entries.map(e => renderTreeNode(e, path)).join('');

  // Recursively render expanded subdirectories
  for (const e of entries) {
    if (e.type === 'directory') {
      const fullPath = path ? `${path}/${e.name}` : e.name;
      if (expandedDirs.has(fullPath)) {
        const childContainer = document.getElementById(`tree-${fullPath.replace(/[/.]/g, '_')}`);
        if (childContainer) await renderTree(fullPath, childContainer);
      }
    }
  }
}

// ── File Editor ──
async function openFile(path) {
  const s = hostedSession();
  const data = s
    ? await lobbyApi(`/lobbies/${s.lobbyId}/repo/file?path=${encodeURIComponent(path)}`)
    : await fetchJson(`/api/files?path=${encodeURIComponent(path)}`);
  if (!data || data.error) return;
  currentPath = path;
  currentContent = data.content || '';
  currentFileName = path.split('/').pop() || path;
  isEditing = false;
  // Default to syntax-highlighted preview for markdown and code files
  const isPreviewable = currentFileName.endsWith('.md') || /\.(ts|tsx|js|jsx|css|html|json|sh|yaml|yml)$/i.test(currentFileName);
  showPreview = isPreviewable;
  renderEditor();
  // Re-render tree to update active highlight
  const treeRoot = document.getElementById('file-tree-root');
  if (treeRoot) await renderTree('', treeRoot);
}

async function saveFile() {
  if (hostedSession()) {
    alert('Editing the connected repo from the panel isn’t available yet — hosted agents land changes as commits/PRs. This view is read-only.');
    return;
  }
  const textarea = document.getElementById('file-editor-textarea');
  if (!textarea) return;
  const content = textarea.value;
  const result = await putJson(`/api/files?path=${encodeURIComponent(currentPath)}`, { content });
  if (result?.ok) {
    currentContent = content;
    isEditing = false;
    renderEditor();
  } else {
    alert('Save failed: ' + (result?.error || 'unknown'));
  }
}

function renderEditor() {
  const el = document.getElementById('file-editor');
  if (!el) return;

  if (!currentPath) {
    const s = hostedSession();
    const isError = s && dirCache.has('') && dirCache.get('').error;
    if (isError) {
      el.innerHTML = `
        <div class="empty-state" style="padding:40px; text-align:center;">
          <div style="font-size:48px;margin-bottom:16px;">🐙</div>
          <h3 style="font-size:16px;font-weight:600;margin-bottom:8px;color:var(--color-text);">GitHub Repository Not Connected</h3>
          <p style="color:var(--color-text-soft); max-width:400px; margin:8px auto 24px; font-size:13px; line-height:1.5;">
            To browse, view, and run agent scripts server-side, you need to connect your GitHub repository to this lobby.
          </p>
          <button class="btn btn-primary" onclick="document.querySelector('button[data-tab=\\'lobby\\']').click()" style="padding:8px 16px; font-size:12px; height:auto; line-height:1.2; border:none; cursor:pointer;">
            Go to Lobby Integrations
          </button>
        </div>
      `;
      return;
    }
    el.innerHTML = '<div class="empty-state" style="padding:40px;">Select a file from the tree to view or edit it.</div>';
    return;
  }

  const isMd = currentFileName.endsWith('.md');
  const isCode = /\.(ts|tsx|js|jsx|css|html|json|sh|yaml|yml)$/i.test(currentFileName);
  const canPreview = isMd || isCode;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--bg-surface);">
      <div>
        <strong style="font-size:13px;">${escapeHtml(currentFileName)}</strong>
        <span style="font-size:11px;color:var(--text-muted);margin-left:8px;">${escapeHtml(currentPath)}</span>
      </div>
      <div style="display:flex;gap:6px;">
        ${canPreview ? `<button class="btn btn-secondary btn-sm" id="file-toggle-preview">${showPreview ? '✏️ Edit' : '👁 View'}</button>` : ''}
        ${!showPreview ? `<button class="btn btn-primary btn-sm" id="file-save-btn">Save</button>` : ''}
      </div>
    </div>
    <div style="flex:1;overflow:auto;">
      ${showPreview
        ? (isMd
          ? `<div id="file-preview" style="padding:16px;font-size:13px;line-height:1.6;">${renderMarkdown(currentContent)}</div>`
          : `<pre id="file-preview" style="padding:16px;font-size:12px;line-height:1.5;margin:0;overflow-x:auto;"><code>${highlightSyntax(currentContent, currentFileName)}</code></pre>`)
        : (isCode
          ? `<div id="file-editor-wrapper" style="position:relative;width:100%;height:100%;">
              <pre id="file-editor-highlight" aria-hidden="true" style="position:absolute;top:0;left:0;right:0;bottom:0;padding:12px;font-family:var(--mono);font-size:12px;line-height:1.5;margin:0;overflow:auto;pointer-events:none;white-space:pre-wrap;word-wrap:break-word;color:var(--text-primary);"><code>${highlightSyntax(currentContent, currentFileName)}</code></pre>
              <textarea id="file-editor-textarea" spellcheck="false" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;padding:12px;font-family:var(--mono);font-size:12px;background:transparent;color:transparent;caret-color:var(--text-primary);resize:none;line-height:1.5;outline:none;white-space:pre-wrap;word-wrap:break-word;z-index:1;">${escapeHtml(currentContent)}</textarea>
            </div>`
          : `<textarea id="file-editor-textarea" style="width:100%;height:100%;border:none;padding:12px;font-family:var(--mono);font-size:12px;background:var(--bg-base);color:var(--text-primary);resize:none;line-height:1.5;outline:none;">${escapeHtml(currentContent)}</textarea>`)
      }
    </div>
  `;

  document.getElementById('file-toggle-preview')?.addEventListener('click', () => {
    // Capture edits before toggling
    const textarea = document.getElementById('file-editor-textarea');
    if (textarea) currentContent = textarea.value;
    showPreview = !showPreview;
    renderEditor();
  });

  document.getElementById('file-save-btn')?.addEventListener('click', saveFile);

  // Sync highlight layer with textarea edits (for code files in edit mode)
  const editorTextarea = document.getElementById('file-editor-textarea');
  const highlightPre = document.getElementById('file-editor-highlight');
  if (editorTextarea && highlightPre) {
    // Sync scrolling
    editorTextarea.addEventListener('scroll', () => {
      highlightPre.scrollTop = editorTextarea.scrollTop;
      highlightPre.scrollLeft = editorTextarea.scrollLeft;
    });
    // Re-highlight on input
    editorTextarea.addEventListener('input', () => {
      const code = highlightPre.querySelector('code');
      if (code) code.innerHTML = highlightSyntax(editorTextarea.value, currentFileName);
    });
  }

  // Ctrl+S to save
  document.getElementById('file-editor-textarea')?.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveFile();
    }
  });
}

// ── Tab Render ──
function render() {
  const el = document.getElementById('files-content');
  if (!el) return;

  el.innerHTML = `
    <div style="display:flex;height:100%;">
      <div style="width:280px;min-width:200px;border-right:1px solid var(--border);overflow-y:auto;background:var(--bg-surface);">
        <div style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border);">
          Project Root
        </div>
        <div id="file-tree-root" style="font-size:12px;padding:4px 0;"></div>
      </div>
      <div id="file-editor" style="flex:1;display:flex;flex-direction:column;overflow:hidden;"></div>
    </div>
  `;

  // Load and render tree
  renderTree('', document.getElementById('file-tree-root'));
  renderEditor();

  // Event delegation for tree clicks
  document.getElementById('file-tree-root')?.addEventListener('click', async (e) => {
    const item = e.target.closest('.tree-item');
    if (!item) return;
    const path = item.dataset.path;
    const type = item.dataset.type;

    if (type === 'dir') {
      if (expandedDirs.has(path)) {
        expandedDirs.delete(path);
      } else {
        expandedDirs.add(path);
      }
      dirCache.delete(path); // refresh on toggle
      await renderTree('', document.getElementById('file-tree-root'));
    } else if (type === 'file') {
      await openFile(path);
    }
  });
}

function init() {
  render();
}

function onActivate() {
  // Refresh tree when tab is activated
  dirCache.clear();
  const treeRoot = document.getElementById('file-tree-root');
  if (treeRoot) renderTree('', treeRoot);
}

registerTab('files', { init, onActivate });
