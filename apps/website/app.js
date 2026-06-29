// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

document.addEventListener('DOMContentLoaded', () => {
  // Operating Modes tab switcher
  const modeButtons = document.querySelectorAll('.mode-tab-btn');
  const modePanels = document.querySelectorAll('.mode-panel');

  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');

      // Update active button state
      modeButtons.forEach(b => b.classList.toggle('active', b === btn));

      // Show the selected panel
      modePanels.forEach(panel => {
        const panelMode = panel.getAttribute('id');
        panel.classList.toggle('active', panelMode === `mode-${mode}`);
      });
    });
  });

  // Code Copy Utility
  const copyBtn = document.querySelector('.copy-btn');
  const codeBlock = document.querySelector('.code-block code');

  if (copyBtn && codeBlock) {
    copyBtn.addEventListener('click', () => {
      const text = codeBlock.textContent;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.style.background = 'var(--color-green)';
        copyBtn.style.color = '#000';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.style.background = 'rgba(255, 255, 255, 0.1)';
          copyBtn.style.color = 'var(--color-text)';
        }, 2000);
      }).catch(() => {
        // Fallback
        alert('Could not copy code. Please select and copy manually.');
      });
    });
  }
});
