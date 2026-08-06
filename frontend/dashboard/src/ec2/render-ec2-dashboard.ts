/**
 * Renders shared EC2 dashboard widgets from a normalized view model.
 */

import { renderEc2CostBreakdownCard } from '../components/EC2CostBreakdownCard';
import { renderEc2ExecutiveSummaryCard } from '../components/EC2ExecutiveSummaryCard';
import { renderEc2InstanceMixCard } from '../components/EC2InstanceMixCard';
import { renderEc2RightsizingCard } from '../components/EC2RightsizingCard';
import { renderEc2SecurityFindingsCard } from '../components/EC2SecurityFindingsCard';
import { renderEc2SummaryCard } from '../components/EC2SummaryCard';
import { escapeHtml } from '../utils/format';
import type { Ec2DashboardViewModel } from './ec2-dashboard-view-model';
import {
  mapViewModelToCostBreakdown,
  mapViewModelToEc2Summary,
  mapViewModelToInstanceMix,
  mapViewModelToSecurityFindings,
} from './ec2-dashboard-view-model';

export interface Ec2DashboardPanelElements {
  chrome: HTMLElement;
  summary: HTMLElement;
  cost: HTMLElement;
  instanceMix: HTMLElement;
  security: HTMLElement;
  rightsizing: HTMLElement;
  executive: HTMLElement;
  statusBanner?: HTMLElement;
}

export function renderEc2DashboardChrome(
  container: HTMLElement,
  vm: Ec2DashboardViewModel,
  options?: { showSignInCta?: boolean },
): void {
  const modeClass = vm.mode === 'demo' ? 'ec2-mode-demo' : 'ec2-mode-live';
  const badge =
    vm.mode === 'demo'
      ? '<span class="ec2-source-badge demo-badge">DEMO DATA</span>'
      : '<span class="ec2-source-badge live-badge">LIVE AWS DATA</span>';

  const notice =
    vm.mode === 'demo'
      ? '<p class="ec2-demo-notice">Illustrative EC2 environment — not connected to a live AWS account.</p>'
      : '';

  const accountLine = vm.accountLabel
    ? `<p class="ec2-account-label">${escapeHtml(vm.accountLabel)} · ${escapeHtml(vm.region)}</p>`
    : '';

  const cta =
    options?.showSignInCta && vm.mode === 'demo'
      ? '<p class="ec2-demo-cta"><a href="/dashboard/index.html">Sign in</a> to connect a live AWS account.</p>'
      : '';

  container.innerHTML = `
    <header class="ec2-dashboard-chrome ${modeClass}">
      ${badge}
      <h2>${escapeHtml(vm.title)}</h2>
      <p class="hero-subtitle">${escapeHtml(vm.subtitle)}</p>
      ${notice}
      ${accountLine}
      ${cta}
    </header>
  `;
}

export function renderEc2DashboardStatusBanner(container: HTMLElement, vm: Ec2DashboardViewModel): void {
  if (vm.dataStatus === 'LOADING') {
    container.hidden = false;
    container.textContent = 'Loading EC2 dashboard…';
    return;
  }
  if (vm.dataStatus === 'ERROR') {
    container.hidden = false;
    container.className = 'ec2-status-banner error';
    container.textContent = vm.errors[0] ?? 'Unable to load EC2 dashboard.';
    return;
  }
  if (vm.dataStatus === 'EMPTY') {
    container.hidden = false;
    container.className = 'ec2-status-banner empty';
    container.textContent =
      'No EC2 instances in this account. Inventory may still list other EC2 resource types.';
    return;
  }
  if (vm.dataStatus === 'PARTIAL') {
    container.hidden = false;
    container.className = 'ec2-status-banner partial';
    container.textContent = vm.warnings.join(' ') || 'Some EC2 sections are unavailable.';
    return;
  }
  if (vm.dataStatus === 'STALE') {
    container.hidden = false;
    container.className = 'ec2-status-banner stale';
    container.textContent =
      vm.freshnessStatus ??
      (vm.lastDiscoveryAt
        ? `Last discovery ${vm.lastDiscoveryAt}. Run discovery to refresh.`
        : 'Discovery data may be stale.');
    return;
  }
  container.hidden = true;
  container.textContent = '';
}

export function renderEc2DashboardPanels(
  elements: Ec2DashboardPanelElements,
  vm: Ec2DashboardViewModel,
): void {
  renderEc2DashboardChrome(elements.chrome, vm, { showSignInCta: vm.mode === 'demo' });

  if (elements.statusBanner) {
    renderEc2DashboardStatusBanner(elements.statusBanner, vm);
  }

  if (vm.dataStatus === 'LOADING') {
    const loading = '<p class="empty-note">Loading EC2 data…</p>';
    for (const panel of [
      elements.summary,
      elements.cost,
      elements.instanceMix,
      elements.security,
      elements.rightsizing,
      elements.executive,
    ]) {
      panel.innerHTML = loading;
    }
    return;
  }

  if (vm.dataStatus === 'ERROR') {
    const errorNote = `<p class="empty-note">${escapeHtml(vm.errors[0] ?? 'Unable to load EC2 data.')}</p>`;
    for (const panel of [
      elements.summary,
      elements.cost,
      elements.instanceMix,
      elements.security,
      elements.rightsizing,
      elements.executive,
    ]) {
      panel.innerHTML = errorNote;
    }
    return;
  }

  renderEc2SummaryCard(elements.summary, mapViewModelToEc2Summary(vm));
  renderEc2CostBreakdownCard(elements.cost, mapViewModelToCostBreakdown(vm));

  const mix = mapViewModelToInstanceMix(vm);
  if (mix.byFamily.length === 0) {
    elements.instanceMix.innerHTML =
      '<p class="empty-note">No EC2 instance types — zero instances in this account.</p>';
  } else {
    renderEc2InstanceMixCard(elements.instanceMix, mix);
  }

  const security = mapViewModelToSecurityFindings(vm);
  if (security.unavailableMessage) {
    elements.security.innerHTML = `<p class="empty-note">${escapeHtml(security.unavailableMessage)}</p>`;
  } else {
    renderEc2SecurityFindingsCard(elements.security, security.findings);
  }

  renderEc2RightsizingCard(elements.rightsizing, vm.optimization.rightsizing);
  renderEc2ExecutiveSummaryCard(elements.executive, vm.executive);
}

export function buildEc2JsonReport(vm: Ec2DashboardViewModel): string {
  const payload = {
    label: vm.reports.watermark ?? vm.reports.label,
    mode: vm.mode,
    generatedAt: vm.generatedAt,
    accountIdSuffix: vm.accountIdSuffix,
    region: vm.region,
    inventory: vm.inventory,
    cost: {
      validatedMonthlySavings: vm.cost.validatedMonthlySavings,
      sampleEstimateMonthlySavings: vm.cost.sampleEstimateMonthlySavings,
      pricingLabel: vm.cost.pricingLabel,
      recommendationCount: vm.cost.recommendations.length,
    },
    securityStatus: vm.security.status,
    executive: vm.executive,
    freshness: {
      lastDiscoveryAt: vm.lastDiscoveryAt,
      latestCostAnalysisAt: vm.latestCostAnalysisAt,
    },
  };
  return JSON.stringify(payload, null, 2);
}
