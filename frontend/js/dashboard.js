// dashboard.js — Florence, Week 1 Day 2
// Handles all API calls, loading/empty/error states, and dashboard rendering.
// API base URL is read from localStorage so it can be set without a code change:
//   localStorage.setItem('ews_api_base', 'https://YOUR-API-URL')
// Falls back to mock data when no URL is set.

// ─── Config ────────────────────────────────────────────────────────────────
const API_BASE = localStorage.getItem('ews_api_base') || null;
const AUTH_TOKEN = localStorage.getItem('ews_auth_token') || null;

function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) h['Authorization'] = AUTH_TOKEN;
  return h;
}

// ─── State helpers ──────────────────────────────────────────────────────────
// Every data-driven element on the dashboard has three states:
// LOADING — show spinner while fetch is in progress
// EMPTY   — show a friendly message when the API returns no data
// ERROR   — show a clear message when the fetch fails

function showLoading(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = `
    <div class="ews-state ews-state--loading">
      <div class="ews-spinner"></div>
      <span>Loading...</span>
    </div>`;
}

function showEmpty(elementId, message = 'No data available') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = `
    <div class="ews-state ews-state--empty">
      <span>📭 ${message}</span>
    </div>`;
}

function showError(elementId, message = 'Could not load data — please try again') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = `
    <div class="ews-state ews-state--error">
      <span>⚠️ ${message}</span>
    </div>`;
}

// ─── API calls ──────────────────────────────────────────────────────────────

async function fetchClients() {
  if (!API_BASE) return { ok: true, data: EWS_MOCK_CLIENTS };
  try {
    const res = await fetch(`${API_BASE}/v1/clients`, { headers: apiHeaders() });
    if (res.status === 401) return { ok: false, status: 401, error: 'Not authorised — please sign in' };
    if (!res.ok) return { ok: false, status: res.status, error: `Server error (${res.status})` };
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: 'Network error — check your connection' };
  }
}

async function fetchDashboard(clientId) {
  if (!API_BASE) {
    const client = EWS_MOCK_CLIENTS.find(c => c.id === clientId) || EWS_MOCK_CLIENTS[0];
    return { ok: true, data: EWS_MOCK_DASHBOARD(client.id, client.name) };
  }
  try {
    const res = await fetch(`${API_BASE}/v1/dashboard/${clientId}`, { headers: apiHeaders() });
    if (res.status === 401) return { ok: false, status: 401, error: 'Not authorised — please sign in' };
    if (res.status === 403) return { ok: false, status: 403, error: 'Access denied for this client' };
    if (!res.ok) return { ok: false, status: res.status, error: `Server error (${res.status})` };
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: 'Network error — check your connection' };
  }
}

async function triggerSync(clientId) {
  if (!API_BASE) return { ok: false, error: 'No API connected — running on mock data' };
  try {
    const res = await fetch(`${API_BASE}/v1/clients/${clientId}/sync`, {
      method: 'POST',
      headers: apiHeaders()
    });
    if (!res.ok) return { ok: false, error: `Sync failed (${res.status})` };
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: 'Sync request failed — check your connection' };
  }
}

// ─── Render helpers ─────────────────────────────────────────────────────────

function renderDataSourceBadge(dataSource) {
  const colours = { mock: '#888', cached: '#3b82f6', aws: '#22c55e' };
  const colour = colours[dataSource] || '#888';
  return `<span style="
    display:inline-block;
    font-size:0.65rem;
    font-weight:700;
    letter-spacing:0.08em;
    text-transform:uppercase;
    color:${colour};
    border:1px solid ${colour};
    padding:0.15rem 0.5rem;
    border-radius:4px;
    margin-left:0.5rem;
  ">${dataSource}</span>`;
}

function renderAlertSeverityBadge(severity) {
  const map = {
    critical: { colour: '#ef4444', label: 'Critical' },
    high:     { colour: '#f97316', label: 'High'     },
    low:      { colour: '#3b82f6', label: 'Info'     }
  };
  const s = map[severity] || map['low'];
  return `<span style="font-size:0.7rem;font-weight:700;color:${s.colour};text-transform:uppercase">${s.label}</span>`;
}

function formatCurrency(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatLastSync(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// ─── Main dashboard load ─────────────────────────────────────────────────────
// Called on page load and whenever the client selector changes.
// Exported as window.ewsDashboard so portal/index.html can call it directly.

window.ewsDashboard = {

  async loadClients(selectElementId) {
    showLoading(selectElementId);
    const result = await fetchClients();
    const el = document.getElementById(selectElementId);
    if (!el) return;

    if (!result.ok) {
      showError(selectElementId, result.error);
      return;
    }
    if (!result.data || result.data.length === 0) {
      showEmpty(selectElementId, 'No clients found');
      return;
    }

    // Rebuild the select element
    el.innerHTML = '';
    result.data.forEach(client => {
      const opt = document.createElement('option');
      opt.value = client.id;
      opt.textContent = `${client.name} (${client.status})`;
      el.appendChild(opt);
    });
  },

  async loadDashboard(clientId, containerIds) {
    // containerIds: { cost, security, resources, insights, meta }
    const ids = containerIds || {};
    Object.values(ids).forEach(id => showLoading(id));

    const result = await fetchDashboard(clientId);

    if (!result.ok) {
      Object.values(ids).forEach(id => showError(id, result.error));
      return;
    }

    const d = result.data;

    // Meta / data source badge
    if (ids.meta) {
      const el = document.getElementById(ids.meta);
      if (el) el.innerHTML = `
        ${renderDataSourceBadge(d.dataSource)}
        <span style="font-size:0.75rem;color:#888;margin-left:0.5rem">
          Last synced: ${formatLastSync(d.lastSync)}
        </span>`;
    }

    // Cost section
    if (ids.cost) {
      const el = document.getElementById(ids.cost);
      if (el) {
        if (!d.cost) { showEmpty(ids.cost, 'No cost data available'); }
        else {
          const delta = d.cost.spendDeltaPercent;
          const deltaColour = delta < 0 ? '#22c55e' : '#ef4444';
          const deltaArrow  = delta < 0 ? '↓' : '↑';
          el.innerHTML = `
            <div class="ews-card-grid">
              <div class="ews-card">
                <h4>Monthly Spend</h4>
                <p class="ews-card-value">${formatCurrency(d.cost.monthlySpend)}</p>
                <span style="color:${deltaColour};font-size:0.8rem;font-weight:600">
                  ${deltaArrow} ${Math.abs(delta)}% vs last month
                </span>
              </div>
              <div class="ews-card">
                <h4>Forecasted Spend</h4>
                <p class="ews-card-value">${formatCurrency(d.cost.forecastedSpend)}</p>
                <span style="color:#888;font-size:0.8rem">Next billing cycle</span>
              </div>
              <div class="ews-card ews-card--gold">
                <h4>Savings Opportunity</h4>
                <p class="ews-card-value" style="color:var(--ews-gold,#DBAC18)">
                  ${formatCurrency(d.cost.estimatedSavings)}
                </p>
                <span style="color:#aaa;font-size:0.8rem">From idle resources</span>
              </div>
            </div>`;
        }
      }
    }

    // Security section
    if (ids.security) {
      const el = document.getElementById(ids.security);
      if (el) {
        if (!d.security) { showEmpty(ids.security, 'No security data available'); }
        else if (!d.security.alerts || d.security.alerts.length === 0) {
          el.innerHTML = `
            <div class="ews-state ews-state--empty">✅ No alerts detected — environment looks healthy</div>`;
        } else {
          const rows = d.security.alerts.map(a => `
            <div class="ews-alert-row">
              <span class="ews-alert-dot ews-alert-dot--${a.severity}"></span>
              <span class="ews-alert-msg">${a.message}</span>
              ${renderAlertSeverityBadge(a.severity)}
            </div>`).join('');
          el.innerHTML = `
            <p style="font-size:0.85rem;color:#aaa;margin-bottom:0.75rem">
              ${d.security.openAlerts} open alert${d.security.openAlerts !== 1 ? 's' : ''} 
              · Security score: ${d.security.healthScore}/100
            </p>
            <div class="ews-alert-list">${rows}</div>`;
        }
      }
    }

    // Resources section
    if (ids.resources) {
      const el = document.getElementById(ids.resources);
      if (el) {
        if (!d.resources) { showEmpty(ids.resources, 'No resource data available'); }
        else {
          el.innerHTML = `
            <div class="ews-card-grid">
              <div class="ews-card">
                <h4>Active EC2 Instances</h4>
                <p class="ews-card-value">${d.resources.activeEc2}</p>
                <span style="color:#888;font-size:0.8rem">Normal capacity</span>
              </div>
              <div class="ews-card">
                <h4>S3 Storage</h4>
                <p class="ews-card-value">${d.resources.s3StorageTb} TB</p>
                <span style="color:#888;font-size:0.8rem">Across all buckets</span>
              </div>
              <div class="ews-card">
                <h4>Uptime</h4>
                <p class="ews-card-value" style="color:#22c55e">${d.resources.uptimePercent}%</p>
                <span style="color:#888;font-size:0.8rem">Last 30 days</span>
              </div>
            </div>`;
        }
      }
    }

    // Insights section
    if (ids.insights) {
      const el = document.getElementById(ids.insights);
      if (el) {
        if (!d.insights) { showEmpty(ids.insights, 'No insights available yet'); }
        else {
          const recs = (d.insights.recommendations || []).map(r => `
            <div class="ews-rec-row">
              <span class="ews-rec-title">${r.title}</span>
              <span class="ews-rec-impact">Impact: ${r.impact}</span>
              <span class="ews-rec-saving">Save ~${formatCurrency(r.estimatedSavings)}/mo</span>
            </div>`).join('');
          el.innerHTML = `
            <p style="font-size:0.9rem;color:#ccc;margin-bottom:1rem">${d.insights.executiveSummary}</p>
            ${recs ? `<div class="ews-rec-list">${recs}</div>` : ''}`;
        }
      }
    }
  },

  async sync(clientId, statusElementId) {
    const el = document.getElementById(statusElementId);
    if (el) el.textContent = 'Syncing...';
    const result = await triggerSync(clientId);
    if (el) {
      el.textContent = result.ok
        ? `Synced — dataSource: ${result.data?.dataSource || 'aws'}`
        : result.error;
    }
    return result;
  },

  // Utility: reads ?api= query param and saves to localStorage on first load
  // This is what the sprint plan's Day 5 step does automatically
  initApiFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get('api');
    if (apiParam) {
      localStorage.setItem('ews_api_base', apiParam);
      console.log('[EWS] API base URL saved from query param:', apiParam);
    }
  }
};
