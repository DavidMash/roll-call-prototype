import { useEffect, useMemo, useRef, useState } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { TutorialBeat, TutorialSession, TutorialUiState } from './types';
import { activeTutorialBeat } from './tutorialSteps';
import {
  configureTutorialInteractionGate,
  releaseTutorialInteractionGate,
  tutorialTargetsExist,
} from './interactionGate';

interface SpotlightRect {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  interactive: boolean;
}

function descriptionHtml(beat: TutorialBeat): string {
  const paragraphs = beat.body.map(line => `<p>${line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`).join('');
  return `${paragraphs}${beat.requiredAction ? `<p class="tutorial-required-copy"><strong>${beat.requiredAction}</strong></p>` : ''}`;
}

function queryElements(selectors: string[]) {
  const matches = Array.from(new Set(selectors.flatMap(selector =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)),
  ))).filter(element => element.isConnected && element.getClientRects().length > 0);
  return matches.filter(element => !matches.some(other => other !== element && other.contains(element)));
}

function useSpotlightRects(highlightTargets: string[], interactiveTargets: string[], enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ key: string; rects: SpotlightRect[] }>({ key: '', rects: [] });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const highlightKey = highlightTargets.join('|');
  const interactiveKey = interactiveTargets.join('|');

  useEffect(() => {
    if (!enabled) {
      setSnapshot({ key: '', rects: [] });
      return;
    }
    let frame = 0;
    let observed = new Set<HTMLElement>();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update());
    const update = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const highlights = queryElements(highlightTargets);
      const interactive = queryElements(interactiveTargets);
      const current = new Set(highlights);
      observed.forEach(element => {
        if (!current.has(element)) resizeObserver?.unobserve(element);
      });
      highlights.forEach(element => {
        if (!observed.has(element)) resizeObserver?.observe(element);
      });
      observed = current;
      setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
      const rects = highlights.map((element, index) => {
        const bounds = element.getBoundingClientRect();
        const padding = 5;
        const x = Math.max(3, bounds.left - padding);
        const y = Math.max(3, bounds.top - padding);
        return {
          key: `${index}-${element.dataset.tutorial ?? element.dataset.testid ?? element.className}`,
          x,
          y,
          width: Math.max(1, Math.min(width - x - 3, bounds.width + padding * 2)),
          height: Math.max(1, Math.min(height - y - 3, bounds.height + padding * 2)),
          interactive: interactive.some(target => target === element || element.contains(target) || target.contains(element)),
        };
      });
      setSnapshot(previous => {
        const nextKey = `${highlightKey}:${rects.map(rect => `${rect.key}:${rect.x}:${rect.y}:${rect.width}:${rect.height}:${rect.interactive}`).join('|')}`;
        return previous.key === nextKey ? previous : { key: nextKey, rects };
      });
      frame = requestAnimationFrame(update);
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [enabled, highlightKey, interactiveKey]);

  return { rects: snapshot.key.startsWith(`${highlightKey}:`) ? snapshot.rects : [], viewport };
}

function TutorialSpotlightLayer({ beat, rects, viewport }: {
  beat: TutorialBeat;
  rects: SpotlightRect[];
  viewport: { width: number; height: number };
}) {
  if (rects.length === 0 || viewport.width === 0 || viewport.height === 0) return null;
  return <div className="tutorial-spotlight-layer" data-testid="tutorial-spotlight-layer" aria-hidden="true">
    <svg viewBox={`0 0 ${viewport.width} ${viewport.height}`} preserveAspectRatio="none">
      <defs>
        <mask id="tutorial-multi-spotlight-mask">
          <rect width={viewport.width} height={viewport.height} fill="white" />
          {rects.map(rect => <rect key={rect.key} x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="9" fill="black" />)}
        </mask>
      </defs>
      <rect width={viewport.width} height={viewport.height} fill={`rgba(0, 0, 0, ${beat.blocking ? 0.72 : 0.42})`}
        mask="url(#tutorial-multi-spotlight-mask)" />
    </svg>
    {rects.map(rect => <div key={rect.key} className={`tutorial-spotlight-region${rect.interactive ? ' is-interactive' : ''}`}
      data-testid="tutorial-highlight-region" data-interactive={rect.interactive ? 'true' : 'false'}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />)}
  </div>;
}

export function TutorialDirector({ session, uiState, paused, beatOverride, onAcknowledge, onRecover, onFinish }: {
  session: TutorialSession;
  uiState: TutorialUiState;
  paused: boolean;
  beatOverride?: TutorialBeat;
  onAcknowledge: (beatId: string) => void;
  onRecover: (beatId: string) => void;
  onFinish: () => void;
}) {
  const beat = useMemo(() => paused ? null : beatOverride ?? activeTutorialBeat(session, uiState), [paused, beatOverride, session, uiState.selection,
    uiState.selectedOffer, uiState.selectedFlameOffer, uiState.flameDetailsOpen]);
  const highlightTargets = beat?.highlightTargets ?? (beat?.target ? [beat.target] : []);
  const interactiveTargets = beat?.interactiveTargets ?? [];
  const usesMultiSpotlight = highlightTargets.length > 1;
  const { rects, viewport } = useSpotlightRects(highlightTargets, interactiveTargets, !!beat && highlightTargets.length > 0);
  const instance = useRef<Driver | null>(null);
  const acknowledged = useRef(onAcknowledge);
  const recover = useRef(onRecover);
  const finish = useRef(onFinish);
  acknowledged.current = onAcknowledge;
  recover.current = onRecover;
  finish.current = onFinish;

  const spotlightGeometry = rects.map(rect => `${rect.key}:${rect.x}:${rect.y}:${rect.width}:${rect.height}`).join('|');
  useEffect(() => {
    instance.current?.refresh();
  }, [spotlightGeometry]);

  useEffect(() => {
    instance.current?.destroy();
    instance.current = null;
    releaseTutorialInteractionGate();
    const gatesInteractions = !!beat && !beat.blocking && beat.gateInteractions !== false;
    document.body.classList.toggle('tutorial-required-action', gatesInteractions);
    document.body.classList.toggle('tutorial-multi-spotlight-active', !!beat && usesMultiSpotlight);
    if (!beat) return () => {
      document.body.classList.remove('tutorial-required-action', 'tutorial-multi-spotlight-active');
    };

    let cancelled = false;
    let frame = 0;
    let popoverTimer = 0;
    let gateGeneration: number | null = null;
    let previousGeometry = '';
    let stableFrames = 0;
    const show = (attempt = 0) => {
      if (cancelled) return;
      const primarySelector = beat.target ?? highlightTargets[0];
      const target = primarySelector ? document.querySelector<HTMLElement>(primarySelector) : null;
      const interactiveReady = beat.blocking || interactiveTargets.length === 0 || tutorialTargetsExist(interactiveTargets);
      const geometry = target ? (() => {
        const bounds = target.getBoundingClientRect();
        return `${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(bounds.width)}:${Math.round(bounds.height)}`;
      })() : '';
      if (geometry && geometry === previousGeometry) stableFrames += 1;
      else stableFrames = 0;
      previousGeometry = geometry;
      const waiting = (primarySelector && !target) || !interactiveReady || (!!target && stableFrames < 2);
      if (waiting && attempt < 90) {
        frame = requestAnimationFrame(() => show(attempt + 1));
        return;
      }
      if ((primarySelector && !target) || (!beat.blocking && !interactiveReady)) {
        releaseTutorialInteractionGate();
        recover.current(beat.recoveryBeatId ?? beat.id);
        return;
      }
      const finishBeat = () => beat.id === 'tutorial-run-over' ? finish.current() : acknowledged.current(beat.id);
      const showsAcknowledgeButton = beat.blocking || beat.completion?.kind === 'acknowledge';
      const control = driver({
        animate: true,
        allowClose: false,
        overlayOpacity: usesMultiSpotlight ? 0 : beat.blocking ? 0.72 : 0.42,
        stagePadding: 7,
        stageRadius: 9,
        popoverOffset: 12,
        popoverClass: 'roll-call-tutorial-popover',
        disableActiveInteraction: beat.blocking,
        showProgress: false,
        showButtons: showsAcknowledgeButton ? ['next'] : [],
        nextBtnText: beat.actionLabel ?? 'GOT IT',
        onNextClick: finishBeat,
      });
      instance.current = control;
      control.highlight({
        ...(target ? { element: target } : {}),
        popover: {
          title: beat.title,
          description: descriptionHtml(beat),
          side: beat.side ?? 'bottom',
          align: 'center',
          showButtons: showsAcknowledgeButton ? ['next'] : [],
          nextBtnText: beat.actionLabel ?? 'GOT IT',
          onNextClick: finishBeat,
        },
      });
      if (gatesInteractions) gateGeneration = configureTutorialInteractionGate(interactiveTargets,
        () => recover.current(beat.recoveryBeatId ?? beat.id));
      popoverTimer = window.setTimeout(() => {
        if (cancelled) return;
        const popover = document.querySelector<HTMLElement>('.driver-popover');
        if (!beat.blocking) {
          document.querySelector<SVGElement>('.driver-overlay')?.style.setProperty('pointer-events', 'none', 'important');
          if (!showsAcknowledgeButton) popover?.style.setProperty('pointer-events', 'none', 'important');
        }
        popover?.setAttribute('role', 'dialog');
        popover?.setAttribute('aria-modal', beat.blocking ? 'true' : 'false');
        popover?.setAttribute('aria-label', beat.title ?? 'Tutorial');
        if (beat.blocking) popover?.querySelector<HTMLElement>('button')?.focus();
        else if (!gatesInteractions) queryElements(interactiveTargets)[0]?.focus();
      }, 0);
    };
    show();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(popoverTimer);
      if (gateGeneration !== null) releaseTutorialInteractionGate(gateGeneration);
      instance.current?.destroy();
      instance.current = null;
      document.body.classList.remove('tutorial-required-action', 'tutorial-multi-spotlight-active');
    };
  }, [beat?.id, beat?.body.join('|'), beat?.target, beat?.blocking, beat?.gateInteractions,
    highlightTargets.join('|'), interactiveTargets.join('|'), usesMultiSpotlight]);

  return <>
    {beat && usesMultiSpotlight && <TutorialSpotlightLayer beat={beat} rects={rects} viewport={viewport} />}
    <div className="sr-only" role="status" aria-live="assertive" data-testid="tutorial-announcer">
      {beat ? `${beat.title ?? 'Tutorial'}. ${beat.body.join(' ')} ${beat.requiredAction ?? ''}` : ''}
    </div>
  </>;
}
