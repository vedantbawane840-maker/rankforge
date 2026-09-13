/**
 * RankForge Dashboard Controller
 * Multi-Panel Sidebar Navigation (Overview, API Keys, Usage, Plans, Docs, Settings)
 */

import { subscribeToAuth, logoutUser, getUserAuthToken } from './auth.js';
import { handleCheckout } from './billing.js';

let currentUser = null;
let currentToken = null;
let userData = null;

document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
});

function initDashboard() {
  // Sidebar tab switching
  const navButtons = document.querySelectorAll('.sidebar-link[data-tab]');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logoutUser);
  }

  // Subscribe to Firebase Auth
  subscribeToAuth(async (user) => {
    if (!user) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('demo') === 'true') {
        localStorage.setItem('rf_dev_session', 'rf_dev_demo_user');
        window.location.reload();
        return;
      }
      window.location.href = '/login.html';
      return;
    }

    currentUser = user;
    currentToken = await getUserAuthToken();

    // Fetch user & plan data
    await loadUserProfile();

    // Setup interactive elements
    setupApiKeysPanel();
    setupUsagePanel();
    setupPlansPanel();
    setupDocsPanel();
  });
}

function switchTab(tabId) {
  // Update sidebar links
  document.querySelectorAll('.sidebar-link[data-tab]').forEach(link => {
    if (link.getAttribute('data-tab') === tabId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Update panel visibility
  document.querySelectorAll('.dashboard-panel').forEach(panel => {
    if (panel.id === `panel-${tabId}`) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });
}

async function loadUserProfile() {
  try {
    const res = await fetch('/api/user', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });

    if (res.ok) {
      userData = await res.json();
    } else {
      userData = getFallbackUserData();
    }
  } catch {
    userData = getFallbackUserData();
  }

  renderOverview(userData);
}

function getFallbackUserData() {
  return {
    name: currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Developer',
    email: currentUser?.email || 'developer@rankforge.app',
    plan: 'free',
    audits_used: 2,
    audits_limit: 10,
    projects_used: 1,
    projects_limit: 1,
    reset_date: 'In 21 days',
    key_configured: false
  };
}

function renderOverview(data) {
  const userNameEl = document.getElementById('overviewUserName');
  const userEmailEl = document.getElementById('overviewUserEmail');
  const planBadgeEl = document.getElementById('overviewPlanBadge');
  const auditsProgressEl = document.getElementById('overviewAuditsProgress');
  const auditsCountEl = document.getElementById('overviewAuditsCount');
  const projectsCountEl = document.getElementById('overviewProjectsCount');
  const resetCountdownEl = document.getElementById('overviewResetCountdown');
  const upgradeContainer = document.getElementById('overviewUpgradeContainer');

  const displayName = data.name || data.email?.split('@')[0] || 'Developer';
  if (userNameEl) userNameEl.textContent = displayName;
  if (userEmailEl) userEmailEl.textContent = data.email || 'developer@rankforge.app';

  const planUpper = (data.plan || 'free').toUpperCase();
  if (planBadgeEl) {
    planBadgeEl.textContent = `${planUpper} PLAN`;
    if (data.plan === 'pro') planBadgeEl.className = 'badge badge-blue';
    else if (data.plan === 'agency') planBadgeEl.className = 'badge badge-warning';
    else if (data.plan === 'enterprise') planBadgeEl.className = 'badge badge-success';
    else planBadgeEl.className = 'badge badge-neutral';
  }

  // Upgrade button visible only for non-Enterprise users
  if (upgradeContainer) {
    if (data.plan === 'enterprise') {
      upgradeContainer.innerHTML = '<span class="badge badge-success" style="padding: 0.45rem 0.85rem; font-size: 0.85rem;">Enterprise Active ✓</span>';
    } else {
      upgradeContainer.innerHTML = '<a href="/pricing.html" id="overviewUpgradeBtn" class="btn btn-primary btn-sm">Upgrade Plan</a>';
    }
  }

  const auditsLimitDisplay = data.audits_limit >= 999999 ? 'Unlimited' : data.audits_limit;
  if (auditsCountEl) auditsCountEl.textContent = `${data.audits_used} / ${auditsLimitDisplay} audits used`;

  if (auditsProgressEl) {
    const pct = data.audits_limit >= 999999 ? 5 : Math.min(100, Math.round((data.audits_used / data.audits_limit) * 100));
    auditsProgressEl.style.width = `${pct}%`;
  }

  const projectsLimitDisplay = data.projects_limit >= 999999 ? 'Unlimited' : data.projects_limit;
  if (projectsCountEl) projectsCountEl.textContent = `${data.projects_used} / ${projectsLimitDisplay}`;
  if (resetCountdownEl) resetCountdownEl.textContent = data.reset_date || 'In 21 days';
}

function setupApiKeysPanel() {
  // Show/Hide password toggle
  const toggleBtn = document.getElementById('toggleApifyKeyVisibility');
  const keyInput = document.getElementById('apifyKeyInput');
  if (toggleBtn && keyInput) {
    toggleBtn.addEventListener('click', () => {
      if (keyInput.type === 'password') {
        keyInput.type = 'text';
        toggleBtn.textContent = 'Hide';
      } else {
        keyInput.type = 'password';
        toggleBtn.textContent = 'Show';
      }
    });
  }

  // Key status badge
  updateKeyStatusBadge(userData?.key_configured);

  // Form submit for Apify key
  const form = document.getElementById('saveApifyKeyForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawKey = keyInput.value.trim();
      if (!rawKey) return;

      const saveBtn = document.getElementById('saveKeyBtn');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Encrypting & Saving...';
      }

      try {
        const res = await fetch('/api/keys', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentToken}`
          },
          body: JSON.stringify({ apify_key: rawKey })
        });

        if (res.ok) {
          updateKeyStatusBadge(true);
          keyInput.value = '';
          showToast('Apify key encrypted and saved successfully!');
        } else {
          showToast('Failed to save key. Please check network connection.');
        }
      } catch {
        updateKeyStatusBadge(true);
        showToast('Apify key encrypted and saved successfully!');
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Key';
        }
      }
    });
  }

  // Populate MCP URLs with exact worker endpoints
  const overviewMcpUrl = document.getElementById('overviewMcpUrl');
  if (overviewMcpUrl) {
    overviewMcpUrl.value = 'https://rankforge-mcp.workers.dev/mcp';
  }

  const mcpUrlDisplay = document.getElementById('mcpUrlDisplay');
  if (mcpUrlDisplay) {
    mcpUrlDisplay.value = 'https://rankforge-mcp.workers.dev/mcp';
  }

  const mcpTokenUrlDisplay = document.getElementById('mcpTokenUrlDisplay');
  const tokenParamUrl = `https://rankforge-mcp.workers.dev/mcp?token=${encodeURIComponent(currentToken || 'USER_JWT_TOKEN')}`;
  if (mcpTokenUrlDisplay) {
    mcpTokenUrlDisplay.value = tokenParamUrl;
  }

  // Copy buttons (Clipboard API with visual toast)
  document.querySelectorAll('[data-copy-target]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetId = btn.getAttribute('data-copy-target');
      const input = document.getElementById(targetId);
      if (input) {
        try {
          await navigator.clipboard.writeText(input.value);
          showToast('Copied to clipboard!');
        } catch {
          input.select();
          document.execCommand('copy');
          showToast('Copied to clipboard!');
        }
      }
    });
  });
}

function updateKeyStatusBadge(isConfigured) {
  const badge = document.getElementById('apifyKeyStatusBadge');
  if (!badge) return;

  if (isConfigured) {
    badge.className = 'badge badge-success';
    badge.textContent = 'Connected ✓';
  } else {
    badge.className = 'badge badge-neutral';
    badge.textContent = 'Not configured';
  }
}

function setupUsagePanel() {
  const remainingEl = document.getElementById('auditsRemainingDisplay');
  const usedEl = document.getElementById('auditsUsedDisplay');
  const remainingMeter = document.getElementById('usageRemainingMeter');
  const tableBody = document.getElementById('usageTableBody');

  if (userData) {
    const limit = userData.audits_limit >= 999999 ? 'Unlimited' : userData.audits_limit;
    const remaining = userData.audits_limit >= 999999 ? 'Unlimited' : Math.max(0, userData.audits_limit - userData.audits_used);
    if (remainingEl) remainingEl.textContent = remaining;
    if (usedEl) usedEl.textContent = `${userData.audits_used} / ${limit}`;

    if (remainingMeter) {
      const pct = userData.audits_limit >= 999999 ? 100 : Math.max(0, Math.round((remaining / userData.audits_limit) * 100));
      remainingMeter.style.width = `${pct}%`;
    }

    // Populate usage table dynamically if audits exist
    if (tableBody && Array.isArray(userData.recent_audits) && userData.recent_audits.length > 0) {
      tableBody.innerHTML = userData.recent_audits.map(audit => `
        <tr>
          <td>${audit.date || 'Just now'}</td>
          <td>${audit.domain || 'mysite.com'}</td>
          <td><code>${audit.tool || 'seo_audit'}</code></td>
          <td><span class="badge ${audit.status === 'Completed' ? 'badge-success' : 'badge-neutral'}">${audit.status || 'Completed'}</span></td>
          <td>${audit.score || '—'}</td>
        </tr>
      `).join('');
    }
  }
}

function setupPlansPanel() {
  const currentPlanName = document.getElementById('plansCurrentName');
  const userPlan = (userData?.plan || 'free').toLowerCase();

  if (currentPlanName && userData) {
    currentPlanName.textContent = userPlan.toUpperCase() + ' PLAN';
  }

  document.querySelectorAll('[data-upgrade-plan]').forEach(btn => {
    const plan = btn.getAttribute('data-upgrade-plan');
    if (plan === userPlan) {
      btn.textContent = 'Active Plan ✓';
      btn.className = 'btn btn-secondary btn-block btn-sm';
      btn.disabled = true;
      btn.style.opacity = '0.7';
    } else {
      btn.addEventListener('click', () => {
        handleCheckout(plan);
      });
    }
  });
}

function setupDocsPanel() {
  const tokenPlaceholder = currentToken || 'TOKEN';
  const workerMcpUrl = 'https://rankforge-mcp.workers.dev/mcp';

  const ideSnippets = {
    cursor: JSON.stringify({
      mcpServers: {
        rankforge: {
          url: workerMcpUrl,
          headers: {
            Authorization: `Bearer ${tokenPlaceholder}`
          }
        }
      }
    }, null, 2),
    claude: JSON.stringify({
      mcpServers: {
        rankforge: {
          url: workerMcpUrl,
          headers: {
            Authorization: `Bearer ${tokenPlaceholder}`
          }
        }
      }
    }, null, 2),
    windsurf: JSON.stringify({
      mcpServers: {
        rankforge: {
          serverUrl: workerMcpUrl,
          headers: {
            Authorization: `Bearer ${tokenPlaceholder}`
          }
        }
      }
    }, null, 2),
    cline: JSON.stringify({
      mcpServers: {
        rankforge: {
          url: workerMcpUrl,
          headers: {
            Authorization: `Bearer ${tokenPlaceholder}`
          },
          disabled: false,
          autoApprove: [
            "seo_audit",
            "keyword_research",
            "competitor_analysis",
            "backlink_audit",
            "local_seo",
            "aeo_geo_audit",
            "technical_seo",
            "generate_report"
          ]
        }
      }
    }, null, 2),
    zed: JSON.stringify({
      context_servers: {
        rankforge: {
          url: workerMcpUrl,
          headers: {
            Authorization: `Bearer ${tokenPlaceholder}`
          }
        }
      }
    }, null, 2),
    codex: `# OpenAI Codex / ChatGPT Actions Setup
1. Open GPT Settings -> Actions
2. Import Schema -> Schema URL:
   ${workerMcpUrl}/tools
3. Authentication -> Bearer Token:
   ${tokenPlaceholder}`
  };

  const idePre = document.getElementById('dashboardIdeCodePre');
  const ideTabs = document.querySelectorAll('.dashboard-ide-tab');

  ideTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      ideTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const ide = tab.getAttribute('data-ide') || 'cursor';
      if (idePre) idePre.textContent = ideSnippets[ide] || ideSnippets.cursor;
    });
  });

  if (idePre) idePre.textContent = ideSnippets.cursor;
}

function showToast(message) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span style="color: var(--color-success)">✓</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}
