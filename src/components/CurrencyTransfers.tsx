import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Action, GameEvent, GameState, GoldSource, GoldSpendSource, RoundSummary, TemperSource, TemperSpendSource } from '../game/types';

export type TransferCurrency = 'gold' | 'temper';
export type TransferDirection = 'spend' | 'gain';

interface Point { x: number; y: number }
type Anchor = { point: Point } | { selector: string };

interface TransferPlan {
  currency: TransferCurrency;
  direction: TransferDirection;
  amount: number;
  source?: Anchor;
  destination?: Anchor;
  sourceName: string;
}

export interface CurrencyParticle {
  id: number;
  currency: TransferCurrency;
  direction: TransferDirection;
  from: Point;
  to: Point;
  duration: number;
  sourceName: string;
}

interface CurrencySnapshot {
  gold: number;
  temper: number;
  particles: CurrencyParticle[];
  active: boolean;
}

const GOLD_SOURCES: GoldSource[] = ['golden', 'jackpot', 'diceSale', 'roundBase', 'unusedRerolls', 'interest', 'bossReward', 'specialOffer', 'infernoReward'];
const GOLD_SPEND_SOURCES: GoldSpendSource[] = ['dicePurchase', 'diceOfferReroll', 'handTraining', 'flameInvestment', 'lifeRestore', 'furnace', 'greaseTheEngine', 'bribery'];
const TEMPER_SOURCES: TemperSource[] = ['overkill', 'boardRefresh', 'miniBoss', 'boss', 'bonfire', 'engulfment', 'infernoReward'];
const TEMPER_SPEND_SOURCES: TemperSpendSource[] = ['fusion', 'forge'];

const navigationActions = new Set<Action['type']>([
  'SET_SHOP_STAGE', 'SHOP_BACK', 'CONTINUE_ROUND_SUMMARY', 'CONTINUE_INFERNO_METER',
  'CONTINUE_INFERNO_EVALUATION', 'CONTINUE_SCENARIO_RUN', 'NEXT_ROUND', 'NEXT_CHAPTER',
  'RETRY_ROUND', 'CONTINUE_SPECIAL_OFFER', 'CONTINUE_FLAME_SELECTION', 'SKIP_SPECIAL_OFFER',
  'SKIP_FLAME_SELECTION',
]);

function pointForElement(element: Element | null): Point | null {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function resolveAnchor(anchor: Anchor | undefined): Point | null {
  if (!anchor) return null;
  if ('point' in anchor) return anchor.point;
  return typeof document === 'undefined' ? null : pointForElement(document.querySelector(anchor.selector));
}

function sourceAnchor(action: Action, event: GameEvent | undefined, activation: Point | null,
  currency: TransferCurrency, sourceName: string): Anchor | undefined {
  if (currency === 'temper' && sourceName === 'bonfire' && action.type === 'STOKE_FLAME')
    return { selector: `[data-testid="fire-keeping-flame-${action.flameInstanceId}"]` };
  const dieId = event?.dieIds?.[0];
  if (dieId !== undefined) return { selector: `[data-die-id="${dieId}"]` };
  return activation ? { point: activation } : undefined;
}

function eventPlans(action: Action, events: GameEvent[], activation: Point | null): TransferPlan[] {
  const plans: TransferPlan[] = [];
  for (const event of events) {
    const amount = typeof event.amount === 'number' ? Math.max(0, Math.floor(event.amount)) : 0;
    if (!amount) continue;
    if (event.type === 'GOLD_SPENT') plans.push({ currency: 'gold', direction: 'spend', amount,
      destination: activation ? { point: activation } : undefined, sourceName: event.goldSpendSource ?? 'goldSpend' });
    if (event.type === 'GOLD_ADDED') plans.push({ currency: 'gold', direction: 'gain', amount,
      source: sourceAnchor(action, event, activation, 'gold', event.goldSource ?? 'goldReward'), sourceName: event.goldSource ?? 'goldReward' });
    if (event.type === 'TEMPER_CHANGED') {
      const direction: TransferDirection = event.temperSpendSource ? 'spend' : 'gain';
      plans.push({ currency: 'temper', direction, amount,
        ...(direction === 'spend' ? { destination: activation ? { point: activation } : undefined }
          : { source: sourceAnchor(action, event, activation, 'temper', event.temperSource ?? 'temperReward') }),
        sourceName: event.temperSpendSource ?? event.temperSource ?? 'temperChange' });
    }
  }
  return plans;
}

function statPlans(before: GameState, next: GameState, action: Action, activation: Point | null): TransferPlan[] {
  const plans: TransferPlan[] = [];
  for (const source of GOLD_SPEND_SOURCES) {
    const amount = (next.stats.goldSpentBySource[source] ?? 0) - (before.stats.goldSpentBySource[source] ?? 0);
    if (amount > 0) plans.push({ currency: 'gold', direction: 'spend', amount,
      destination: activation ? { point: activation } : undefined, sourceName: source });
  }
  for (const source of GOLD_SOURCES) {
    const amount = (next.stats.goldBySource[source] ?? 0) - (before.stats.goldBySource[source] ?? 0);
    if (amount > 0) plans.push({ currency: 'gold', direction: 'gain', amount,
      source: sourceAnchor(action, undefined, activation, 'gold', source), sourceName: source });
  }
  for (const source of TEMPER_SPEND_SOURCES) {
    const amount = (next.stats.temperSpentBySource[source] ?? 0) - (before.stats.temperSpentBySource[source] ?? 0);
    if (amount > 0) plans.push({ currency: 'temper', direction: 'spend', amount,
      destination: activation ? { point: activation } : undefined, sourceName: source });
  }
  for (const source of TEMPER_SOURCES) {
    const amount = (next.stats.temperBySource[source] ?? 0) - (before.stats.temperBySource[source] ?? 0);
    if (amount > 0) plans.push({ currency: 'temper', direction: 'gain', amount,
      source: sourceAnchor(action, undefined, activation, 'temper', source), sourceName: source });
  }
  return plans;
}

function signedAmount(plan: TransferPlan): number {
  return plan.direction === 'gain' ? plan.amount : -plan.amount;
}

function hasUsableFlight(plan: TransferPlan): boolean {
  const header = resolveAnchor({ selector: `[data-testid="stat-${plan.currency}"]` });
  return plan.direction === 'spend'
    ? !!header && !!resolveAnchor(plan.destination)
    : !!resolveAnchor(plan.source) && !!header;
}

interface PendingSummary { summary: RoundSummary; gold: number; temper: number }

export class CurrencyTransferController {
  private snapshot: CurrencySnapshot;
  private listeners = new Set<() => void>();
  private timers = new Set<number>();
  private generation = 0;
  private nextParticleId = 1;
  private pendingTicks = 0;
  private committed: { gold: number; temper: number };
  private presentationTarget: { gold: number; temper: number };
  private deferredRound = { gold: 0, temper: 0 };
  private activation: { point: Point; at: number } | null = null;
  private pendingSummary: PendingSummary | null = null;
  private preserveNextSceneChange = false;

  constructor(gold: number, temper: number) {
    this.snapshot = { gold, temper, particles: [], active: false };
    this.committed = { gold, temper };
    this.presentationTarget = { gold, temper };
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.snapshot;

  private publish(patch: Partial<CurrencySnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private timeout(callback: () => void, delay: number): number {
    const id = window.setTimeout(() => { this.timers.delete(id); callback(); }, delay);
    this.timers.add(id);
    return id;
  }

  capturePointer(event: Pick<PointerEvent, 'target' | 'clientX' | 'clientY'>) {
    const control = (event.target as Element | null)?.closest('button, [role="button"]');
    if (!control) return;
    this.activation = { point: { x: event.clientX, y: event.clientY }, at: performance.now() };
  }

  captureClick(event: Pick<MouseEvent, 'target' | 'detail'>) {
    if (event.detail !== 0) return;
    const control = (event.target as Element | null)?.closest('button, [role="button"]');
    const point = pointForElement(control ?? null);
    if (point) this.activation = { point, at: performance.now() };
  }

  consumeActivation(): Point | null {
    const current = this.activation;
    this.activation = null;
    return current && performance.now() - current.at < 1500 ? current.point : null;
  }

  syncCommitted(gold: number, temper: number) {
    this.committed = { gold, temper };
    this.presentationTarget = { gold: gold - this.deferredRound.gold, temper: temper - this.deferredRound.temper };
    if (this.pendingTicks === 0 && this.snapshot.particles.length === 0 && !this.pendingSummary)
      this.publish(this.presentationTarget);
  }

  cancelAndSnap(gold: number, temper: number) {
    this.generation++;
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
    this.pendingTicks = 0;
    this.pendingSummary = null;
    this.preserveNextSceneChange = false;
    this.deferredRound = { gold: 0, temper: 0 };
    this.committed = { gold, temper };
    this.presentationTarget = { gold, temper };
    this.publish({ gold, temper, particles: [], active: false });
  }

  prepareResolution(before: GameState, next: GameState, action: Action, events: GameEvent[], activation: Point | null) {
    this.committed = { gold: next.gold, temper: next.temper };
    if (next.phase === 'roundSummary' && next.roundSummary && before.roundSummary !== next.roundSummary) {
      this.pendingSummary = { summary: next.roundSummary, gold: next.gold, temper: next.temper };
      return;
    }
    if (navigationActions.has(action.type)) {
      this.cancelAndSnap(next.gold, next.temper);
      return;
    }
    let plans = eventPlans(action, events, activation);
    if (!plans.length) plans = statPlans(before, next, action, activation);
    const accounted = { gold: 0, temper: 0 };
    for (const plan of plans) accounted[plan.currency] += signedAmount(plan);
    const residualGold = next.gold - before.gold - accounted.gold;
    const residualTemper = next.temper - before.temper - accounted.temper;
    if (residualGold) plans.push({ currency: 'gold', direction: residualGold > 0 ? 'gain' : 'spend',
      amount: Math.abs(residualGold), sourceName: 'unanchoredBalanceChange' });
    if (residualTemper) plans.push({ currency: 'temper', direction: residualTemper > 0 ? 'gain' : 'spend',
      amount: Math.abs(residualTemper), sourceName: 'unanchoredBalanceChange' });
    if (next.phase === 'round') {
      const deferredGoldSources = new Set(['golden', 'jackpot']);
      const deferredTemperSources = new Set(['overkill', 'boardRefresh', 'miniBoss', 'boss']);
      plans = plans.filter(plan => {
        const deferred = plan.direction === 'gain' && (plan.currency === 'gold'
          ? deferredGoldSources.has(plan.sourceName) : deferredTemperSources.has(plan.sourceName));
        if (deferred) this.deferredRound[plan.currency] += plan.amount;
        return !deferred;
      });
    }
    const presentationGold = next.gold - this.deferredRound.gold;
    const presentationTemper = next.temper - this.deferredRound.temper;
    const sceneChanged = before.phase !== next.phase || before.shop?.stage !== next.shop?.stage;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (sceneChanged && (reducedMotion || !plans.some(hasUsableFlight))) {
      this.cancelAndSnap(next.gold, next.temper);
      return;
    }
    // Some committed reward actions advance atomically (for example, Special Offers). Keep the
    // captured source point alive for that resulting scene change; any later navigation still cancels.
    this.preserveNextSceneChange = sceneChanged;
    this.schedule(plans, presentationGold, presentationTemper);
  }

  handleSceneChange(gold: number, temper: number) {
    if (this.preserveNextSceneChange) {
      this.preserveNextSceneChange = false;
      return;
    }
    this.cancelAndSnap(gold, temper);
  }

  playPendingSummary(summary: RoundSummary) {
    const pending = this.pendingSummary;
    if (!pending || pending.summary.round !== summary.round) {
      this.cancelAndSnap(this.committed.gold, this.committed.temper);
      return;
    }
    this.pendingSummary = null;
    this.cancelAndSnap(pending.gold, pending.temper);
    this.publish({ gold: summary.goldAfter - summary.totalGoldEarned,
      temper: pending.temper - summary.temper.total });
    const plans: TransferPlan[] = [
      ['base', summary.sources.baseRewardGold], ['rerolls', summary.sources.unusedRerollGold],
      ['interest', summary.sources.interestGold], ['golden', summary.sources.goldenGold],
      ['jackpot', summary.sources.jackpotGold], ['other', summary.sources.otherGold],
      ['boss', summary.sources.bossRewardGold],
    ].flatMap(([source, raw]) => {
      const amount = Number(raw);
      return amount > 0 ? [{ currency: 'gold' as const, direction: 'gain' as const, amount,
        source: { selector: `[data-currency-source="summary-gold-${source}"]` }, sourceName: `summary-${source}` }] : [];
    });
    const temperRows = [
      ['overkill', summary.temper.overkill], ['boardRefresh', summary.temper.boardRefresh],
      ['miniBoss', summary.temper.miniBoss], ['boss', summary.temper.boss],
    ] as const;
    for (const [source, amount] of temperRows) if (amount > 0) plans.push({ currency: 'temper', direction: 'gain', amount,
      source: { selector: `[data-currency-source="summary-temper-${source}"]` }, sourceName: `summary-${source}` });
    this.schedule(plans, pending.gold, pending.temper);
  }

  private schedule(plans: TransferPlan[], gold: number, temper: number) {
    this.presentationTarget = { gold, temper };
    if (!plans.length) { this.publish({ gold, temper, active: false }); return; }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const resolved = plans.map(plan => ({ plan,
      from: plan.direction === 'spend' ? resolveAnchor({ selector: `[data-testid="stat-${plan.currency}"]` }) : resolveAnchor(plan.source),
      to: plan.direction === 'spend' ? resolveAnchor(plan.destination) : resolveAnchor({ selector: `[data-testid="stat-${plan.currency}"]` }),
    }));
    const animated = reducedMotion ? [] : resolved.filter(item => item.from && item.to);
    const immediate = resolved.filter(item => reducedMotion || !item.from || !item.to);
    if (immediate.length) {
      let nextGold = this.snapshot.gold;
      let nextTemper = this.snapshot.temper;
      for (const { plan } of immediate) {
        if (plan.currency === 'gold') nextGold += signedAmount(plan);
        else nextTemper += signedAmount(plan);
      }
      this.publish({ gold: nextGold, temper: nextTemper });
    }
    const total = animated.reduce((sum, item) => sum + item.plan.amount, 0);
    if (!total) { this.publish({ gold, temper, active: false }); return; }
    const stagger = total <= 1 ? 0 : Math.max(5, Math.min(48, 520 / (total - 1)));
    const duration = total > 40 ? 280 : 360;
    const generation = this.generation;
    let ordinal = 0;
    this.pendingTicks += total;
    this.publish({ active: true });
    for (const item of animated) for (let unit = 0; unit < item.plan.amount; unit++) {
      const delay = Math.round(ordinal++ * stagger);
      this.timeout(() => {
        if (generation !== this.generation) return;
        const particle: CurrencyParticle = { id: this.nextParticleId++, currency: item.plan.currency,
          direction: item.plan.direction, from: item.from!, to: item.to!, duration, sourceName: item.plan.sourceName };
        if (item.plan.direction === 'spend') this.tick(item.plan.currency, -1);
        this.publish({ particles: [...this.snapshot.particles, particle] });
        this.timeout(() => {
          if (generation !== this.generation) return;
          if (item.plan.direction === 'gain') this.tick(item.plan.currency, 1);
          const particles = this.snapshot.particles.filter(current => current.id !== particle.id);
          this.publish({ particles, active: this.pendingTicks > 0 || particles.length > 0 });
        }, duration);
      }, delay);
    }
  }

  private tick(currency: TransferCurrency, delta: number) {
    this.pendingTicks = Math.max(0, this.pendingTicks - 1);
    this.publish(currency === 'gold' ? { gold: this.snapshot.gold + delta } : { temper: this.snapshot.temper + delta });
    if (this.pendingTicks === 0) this.publish(this.presentationTarget);
  }
}

const CurrencyTransferContext = createContext<CurrencyTransferController | null>(null);

export function CurrencyTransferProvider({ controller, children }: { controller: CurrencyTransferController; children: ReactNode }) {
  return <CurrencyTransferContext.Provider value={controller}>{children}</CurrencyTransferContext.Provider>;
}

export function useCurrencyPresentation(currency: TransferCurrency, fallback: number): number {
  const controller = useContext(CurrencyTransferContext);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? (() => () => undefined),
    controller?.getSnapshot ?? (() => ({ gold: fallback, temper: fallback, particles: [], active: false })),
    controller?.getSnapshot ?? (() => ({ gold: fallback, temper: fallback, particles: [], active: false })));
  return controller ? snapshot[currency] : fallback;
}

export function useCurrencyPlaybackActive(): boolean {
  const controller = useContext(CurrencyTransferContext);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? (() => () => undefined),
    controller?.getSnapshot ?? (() => ({ gold: 0, temper: 0, particles: [], active: false })),
    controller?.getSnapshot ?? (() => ({ gold: 0, temper: 0, particles: [], active: false })));
  return controller ? snapshot.active : false;
}

export function CurrencyTransferLayer() {
  const controller = useContext(CurrencyTransferContext);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? (() => () => undefined),
    controller?.getSnapshot ?? (() => ({ gold: 0, temper: 0, particles: [], active: false })),
    controller?.getSnapshot ?? (() => ({ gold: 0, temper: 0, particles: [], active: false })));
  return <div className="currency-transfer-layer" aria-hidden="true" data-testid="currency-transfer-layer">
    {snapshot.particles.map(particle => <span key={particle.id}
      className={`currency-particle currency-particle-${particle.currency}`}
      data-testid="currency-particle" data-currency={particle.currency} data-direction={particle.direction}
      data-source={particle.sourceName}
      style={{ '--currency-from-x': `${particle.from.x}px`, '--currency-from-y': `${particle.from.y}px`,
        '--currency-to-x': `${particle.to.x}px`, '--currency-to-y': `${particle.to.y}px`,
        '--currency-duration': `${particle.duration}ms` } as React.CSSProperties} />)}
  </div>;
}
