const ACTIONABLE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[tabindex]',
].join(',');

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'a[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[role="button"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface RestoredAttributes {
  element: HTMLElement;
  tabIndex: string | null;
  ariaDisabled: string | null;
}

interface ActiveGate {
  generation: number;
  selectors: string[];
  elements: HTMLElement[];
  restored: RestoredAttributes[];
  observer: MutationObserver | null;
  onMissing: () => void;
}

let generation = 0;
let activeGate: ActiveGate | null = null;
let refreshQueued = false;

function queryTargets(selectors: string[]) {
  const matches = selectors.flatMap(selector =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)),
  );
  return Array.from(new Set(matches)).filter(element => element.isConnected && tutorialTargetIsVisible(element));
}

function tutorialTargetIsVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const bounds = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden'
    && element.getAttribute('aria-hidden') !== 'true'
    && bounds.width > 0 && bounds.height > 0 && element.getClientRects().length > 0;
}

function restoreAttributes(gate: ActiveGate) {
  gate.elements.forEach(element => element.classList.remove('tutorial-interactive'));
  gate.restored.forEach(({ element, tabIndex, ariaDisabled }) => {
    if (tabIndex === null) element.removeAttribute('tabindex');
    else element.setAttribute('tabindex', tabIndex);
    if (ariaDisabled === null) element.removeAttribute('aria-disabled');
    else element.setAttribute('aria-disabled', ariaDisabled);
    element.removeAttribute('data-tutorial-gated');
  });
  gate.restored = [];
}

function isWithinAllowed(node: EventTarget | null) {
  if (!(node instanceof Node) || !activeGate) return false;
  return activeGate.elements.some(element => element === node || element.contains(node));
}

function isAllowedOrAncestor(element: HTMLElement) {
  return !!activeGate?.elements.some(target => target === element || target.contains(element) || element.contains(target));
}

function allowedFocusableElements() {
  if (!activeGate) return [];
  const matches = activeGate.elements.flatMap(element => {
    const nested = Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    return element.matches(FOCUSABLE_SELECTOR) ? [element, ...nested] : nested;
  });
  return Array.from(new Set(matches)).filter(
    element => element.isConnected && element.getAttribute('aria-hidden') !== 'true',
  );
}

function focusFirstAllowed() {
  allowedFocusableElements()[0]?.focus({ preventScroll: true });
}

function refreshGate(gate: ActiveGate) {
  if (activeGate !== gate) return;
  gate.observer?.disconnect();
  restoreAttributes(gate);
  gate.elements = queryTargets(gate.selectors);

  if (!tutorialTargetsExist(gate.selectors)) {
    const onMissing = gate.onMissing;
    releaseTutorialInteractionGate(gate.generation);
    queueMicrotask(onMissing);
    return;
  }

  gate.elements.forEach(element => element.classList.add('tutorial-interactive'));
  document.querySelectorAll<HTMLElement>(ACTIONABLE_SELECTOR).forEach(element => {
    if (isAllowedOrAncestor(element) || element.closest('.driver-popover')) return;
    gate.restored.push({
      element,
      tabIndex: element.getAttribute('tabindex'),
      ariaDisabled: element.getAttribute('aria-disabled'),
    });
    element.setAttribute('tabindex', '-1');
    element.setAttribute('aria-disabled', 'true');
    element.setAttribute('data-tutorial-gated', 'true');
  });
  gate.observer?.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-hidden'],
  });
}

function queueRefresh() {
  if (refreshQueued || !activeGate) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    if (activeGate) refreshGate(activeGate);
  });
}

function blockEvent(event: Event) {
  if (!activeGate || isWithinAllowed(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function gateKeydown(event: KeyboardEvent) {
  if (!activeGate) return;

  if (event.key === 'Tab') {
    const focusable = allowedFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length : current) - 1
      : (current + 1) % focusable.length;
    event.preventDefault();
    event.stopImmediatePropagation();
    focusable[next]?.focus({ preventScroll: true });
    return;
  }

  if (event.key === 'Escape' || !isWithinAllowed(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }
}

function gateKeyup(event: KeyboardEvent) {
  if (!activeGate) return;
  if (event.key === 'Tab' || event.key === 'Escape' || !isWithinAllowed(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }
}

function gateFocus(event: FocusEvent) {
  if (!activeGate || isWithinAllowed(event.target)) return;
  event.stopPropagation();
  queueMicrotask(focusFirstAllowed);
}

if (typeof window !== 'undefined') {
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'auxclick', 'dblclick', 'contextmenu'].forEach(
    eventName => document.addEventListener(eventName, blockEvent, true),
  );
  window.addEventListener('keydown', gateKeydown, true);
  window.addEventListener('keyup', gateKeyup, true);
  window.addEventListener('resize', queueRefresh, true);
  document.addEventListener('focusin', gateFocus, true);
}

export function configureTutorialInteractionGate(selectors: string[], onMissing: () => void) {
  releaseTutorialInteractionGate();
  const gate: ActiveGate = {
    generation: ++generation,
    selectors,
    elements: [],
    restored: [],
    observer: typeof MutationObserver === 'undefined' ? null : new MutationObserver(queueRefresh),
    onMissing,
  };
  activeGate = gate;
  refreshGate(gate);
  if (activeGate === gate) queueMicrotask(focusFirstAllowed);
  return activeGate === gate ? gate.generation : null;
}

export function releaseTutorialInteractionGate(expectedGeneration?: number) {
  if (!activeGate) return;
  if (expectedGeneration !== undefined && activeGate.generation !== expectedGeneration) return;
  const gate = activeGate;
  activeGate = null;
  gate.observer?.disconnect();
  restoreAttributes(gate);
}

export function tutorialTargetsExist(selectors: string[]) {
  return selectors.length === 0 || selectors.every(selector =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).some(tutorialTargetIsVisible));
}
