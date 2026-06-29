// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gothard.dk // Ronni K. Gothard Christiansen

document.addEventListener('DOMContentLoaded', () => {
  // Mobile Menu Toggle
  const menuToggle = document.querySelector('.mobile-menu-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      menuToggle.classList.toggle('active');
      navLinks.classList.toggle('mobile-active');
    });

    // Close mobile nav when clicking a link
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        menuToggle.classList.remove('active');
        navLinks.classList.remove('mobile-active');
      });
    });
  }

  // Visual Showcase Gallery Handler
  const galleryButtons = document.querySelectorAll('.gallery-tab-btn');
  const galleryImg = document.getElementById('gallery-active-img');
  const galleryUrl = document.getElementById('gallery-url');
  const galleryDesc = document.getElementById('gallery-desc-text');

  galleryButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Active tab styling
      galleryButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const newImgSrc = btn.getAttribute('data-img');
      const newUrl = btn.getAttribute('data-url');
      const newDesc = btn.getAttribute('data-desc');

      // Smooth image transition
      if (galleryImg) {
        galleryImg.classList.add('fade-out');
        setTimeout(() => {
          galleryImg.setAttribute('src', newImgSrc);
          galleryImg.setAttribute('alt', btn.textContent);
          galleryImg.classList.remove('fade-out');
        }, 150);
      }

      if (galleryUrl) galleryUrl.textContent = newUrl;
      if (galleryDesc) galleryDesc.textContent = newDesc;
    });
  });

  // Tabbed Documentation Handler
  const docButtons = document.querySelectorAll('.docs-side-btn');
  const docPanes = document.querySelectorAll('.docs-pane');

  docButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const docId = btn.getAttribute('data-doc');

      // Update active button state
      docButtons.forEach(b => b.classList.toggle('active', b === btn));

      // Show active pane
      docPanes.forEach(pane => {
        pane.classList.toggle('active', pane.getAttribute('id') === `doc-${docId}`);
      });
    });
  });

  // Operating Modes tab switcher
  const modeButtons = document.querySelectorAll('.mode-tab-btn');
  const modePanels = document.querySelectorAll('.mode-panel');

  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');

      // Update active button state and ARIA attributes
      modeButtons.forEach(b => {
        const isActive = b === btn;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
        b.setAttribute('tabindex', isActive ? '0' : '-1');
      });

      // Show the selected panel and update hidden state
      modePanels.forEach(panel => {
        const panelMode = panel.getAttribute('id');
        const isActive = panelMode === `mode-${mode}`;
        panel.classList.toggle('active', isActive);
        if (isActive) {
          panel.removeAttribute('hidden');
        } else {
          panel.setAttribute('hidden', '');
        }
      });
    });
  });

  // Keyboard navigation for tablist
  const tablist = document.querySelector('.modes-switcher[role="tablist"]');
  if (tablist) {
    tablist.addEventListener('keydown', (e) => {
      const activeTab = document.activeElement;
      if (!activeTab || activeTab.getAttribute('role') !== 'tab') return;

      const tabs = Array.from(modeButtons);
      const index = tabs.indexOf(activeTab);
      let nextIndex = index;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIndex = (index + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = tabs.length - 1;
      } else {
        return; // Allow other keys to propagate
      }

      e.preventDefault();
      tabs[nextIndex].focus();
      tabs[nextIndex].click(); // Auto-activates the tab on arrow focus
    });
  }

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
