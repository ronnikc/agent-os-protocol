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
      // Active tab styling & accessibility state
      galleryButtons.forEach(b => {
        const isActive = b === btn;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
        b.setAttribute('tabindex', isActive ? '0' : '-1');
      });

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

      document.getElementById('tour-screenshot')?.setAttribute('aria-labelledby', btn.id);
      const imageLink = document.getElementById('gallery-image-link');
      if (imageLink) imageLink.href = newImgSrc;
      if (galleryUrl) galleryUrl.textContent = newUrl;
      if (galleryDesc) galleryDesc.textContent = newDesc;
    });
  });

  // Keyboard navigation for visual tour gallery tabs
  const galleryTablist = document.querySelector('.gallery-tabs[role="tablist"]');
  if (galleryTablist) {
    galleryTablist.addEventListener('keydown', (e) => {
      const activeTab = document.activeElement;
      if (!activeTab || activeTab.getAttribute('role') !== 'tab') return;

      const tabs = Array.from(galleryButtons);
      if (tabs.length === 0) return;
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
        return;
      }

      e.preventDefault();
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });
  }

  // Tabbed Documentation Handler
  const docButtons = document.querySelectorAll('.docs-side-btn');
  const docPanes = document.querySelectorAll('.docs-pane');

  docButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const docId = btn.getAttribute('data-doc');

      // Update active button state and accessibility attributes
      docButtons.forEach(b => {
        const isActive = b === btn;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
        b.setAttribute('tabindex', isActive ? '0' : '-1');
      });

      // Show active pane
      docPanes.forEach(pane => {
        pane.classList.toggle('active', pane.getAttribute('id') === `doc-${docId}`);
      });
    });
  });

  // Keyboard navigation for documentation tabs
  const docsTablist = document.querySelector('.docs-sidebar[role="tablist"]');
  if (docsTablist) {
    docsTablist.addEventListener('keydown', (e) => {
      const activeTab = document.activeElement;
      if (!activeTab || activeTab.getAttribute('role') !== 'tab') return;

      const tabs = Array.from(docButtons);
      if (tabs.length === 0) return;
      const index = tabs.indexOf(activeTab);
      let nextIndex = index;

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        nextIndex = (index + 1) % tabs.length;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = tabs.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });
  }

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
      if (tabs.length === 0) return;
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
    copyBtn.addEventListener('click', async () => {
      const text = codeBlock.textContent;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 2000);
      } catch {
        const commands = document.createRange();
        commands.selectNodeContents(codeBlock);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(commands);
        copyBtn.textContent = 'Selected. Copy manually.';
      }
    });
  }

  // Swarm Roster Cohort Filters
  const rosterButtons = document.querySelectorAll('.roster-filter-btn');
  const rosterCards = document.querySelectorAll('.roster-card');

  rosterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const cohort = btn.getAttribute('data-cohort');

      // Update active tab style
      rosterButtons.forEach(b => b.classList.toggle('active', b === btn));

      // Show or hide agent cards matching selected cohort
      rosterCards.forEach(card => {
        const cardCohort = card.getAttribute('data-cohort');
        if (cohort === 'all' || cardCohort === cohort) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });
});
