import { isSearchResultsPage, isVehicleDetailPage } from '../core/page-context.js';

const IGNORE_SELECTOR = [
    '.mobilede-result-article',
    '.mobilede-tech-article',
    '#mobilede-config-btn-wrap',
    '#mobilede-config-overlay',
    '#mobilede-config-popup',
    '.mobilede-srp-price-badge',
    '.mobilede-price-rating',
    '#mobilede-srp-debug-card',
    '.mobilede-srp-debug-card',
].join(', ');

const VIP_CONTENT_SELECTOR = [
    '[data-testid*="vip"]',
    '[data-testid*="features"]',
    '[data-testid*="description"]',
    '[data-testid*="technical"]',
    'main',
].join(', ');

const SRP_CONTENT_SELECTOR = [
    '[data-testid*="result"]',
    '[data-testid="search"]',
    '[data-testid*="search"]',
    'main',
].join(', ');

function isIgnoredNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches?.(IGNORE_SELECTOR)) return true;
    if (node.closest?.(IGNORE_SELECTOR)) return true;
    const id = node.id || '';
    if (id.startsWith('mobilede-')) return true;
    return false;
}

function isRelevantContentElement(el) {
    if (!el || isIgnoredNode(el)) return false;
    if (isSearchResultsPage()) return !!el.closest?.(SRP_CONTENT_SELECTOR);
    if (isVehicleDetailPage()) return !!el.closest?.(VIP_CONTENT_SELECTOR);
    return !!el.closest?.('main, article');
}

export function collectRelevantAddedRoots(mutations) {
    const roots = new Set();
    for (const m of mutations) {
        if (m.type === 'characterData') {
            const el = m.target.parentElement;
            if (el && isRelevantContentElement(el)) roots.add(el);
            continue;
        }
        for (const node of m.addedNodes) {
            if (node.nodeType === 1 && !isIgnoredNode(node)) roots.add(node);
        }
    }
    return roots;
}

export function mutationAffectsPageContent(mutation) {
    if (mutation.type === 'characterData') {
        const el = mutation.target.parentElement;
        return isRelevantContentElement(el);
    }

    if (isIgnoredNode(mutation.target)) return false;

    for (const node of mutation.addedNodes) {
        if (node.nodeType === 1 && !isIgnoredNode(node)) return true;
    }
    for (const node of mutation.removedNodes) {
        if (node.nodeType === 1 && !isIgnoredNode(node)) return true;
    }

    const el = mutation.target.nodeType === 1
        ? mutation.target
        : mutation.target.parentElement;
    return isRelevantContentElement(el);
}
