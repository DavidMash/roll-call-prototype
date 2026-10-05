import { Button, Paper } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { useEffect, useRef, useState } from 'react';
import { BOSSES } from '../game/bosses';
import { chapterNumberForRound, chapterRoundForRound } from '../game/chapters';
import { formatPlayerNumber } from '../game/copy';
import { encounterTarget, nodeLabel, routeWindow } from '../game/progression';
import { SCREEN_THEMES } from '../game/screenThemes';
import type { GameEvent, RunNode } from '../game/types';

const MAP_AUTO_CONTINUE_SECONDS = 3;
const MAP_AUTO_CONTINUE_MS = MAP_AUTO_CONTINUE_SECONDS * 1000;
const MAP_EXIT_MS = 280;

type MapRow = 'bottom' | 'middle' | 'top' | 'reward';
type MapAlignment = 'start' | 'center' | 'end';
type MapNodeState = 'completed' | 'current' | 'upcoming';

export function chapterMapNodeState(index: number, currentIndex: number): MapNodeState {
  if (index < currentIndex) return 'completed';
  if (index === currentIndex) return 'current';
  return 'upcoming';
}

export interface ChapterMapPoint {
  x: number;
  y: number;
  row: MapRow;
  align: MapAlignment;
}

/** Fixed normalized anchors keep the route stable while the current card expands around its stop. */
export const CHAPTER_MAP_POINTS: readonly ChapterMapPoint[] = [
  { x: 9, y: 87, row: 'bottom', align: 'start' },
  { x: 27, y: 87, row: 'bottom', align: 'center' },
  { x: 45, y: 87, row: 'bottom', align: 'center' },
  { x: 63, y: 87, row: 'bottom', align: 'center' },
  { x: 85, y: 87, row: 'bottom', align: 'end' },
  { x: 85, y: 52, row: 'middle', align: 'end' },
  { x: 60, y: 52, row: 'middle', align: 'center' },
  { x: 35, y: 52, row: 'middle', align: 'center' },
  { x: 10, y: 52, row: 'middle', align: 'start' },
  { x: 10, y: 14, row: 'top', align: 'start' },
  { x: 48, y: 14, row: 'top', align: 'center' },
  { x: 85, y: 14, row: 'top', align: 'end' },
  { x: 94, y: 34, row: 'reward', align: 'end' },
] as const;

const ROUTE_SEGMENTS = [
  'M 9 87 L 27 87',
  'M 27 87 L 45 87',
  'M 45 87 L 63 87',
  'M 63 87 L 85 87',
  'M 85 87 C 96 87, 97 52, 85 52',
  'M 85 52 L 60 52',
  'M 60 52 L 35 52',
  'M 35 52 L 10 52',
  'M 10 52 C 2 52, 2 14, 10 14',
  'M 10 14 L 48 14',
  'M 48 14 L 85 14',
  'M 85 14 C 96 14, 98 27, 94 34',
] as const;

function compactGlyph(node: RunNode) {
  if (node.type === 'normal_round') return formatPlayerNumber(chapterRoundForRound(node.round));
  if (node.type === 'shop') return '¤';
  if (node.type === 'mini_boss_round') return '◇';
  if (node.type === 'special_offer') return '◆';
  if (node.type === 'boss_round') return '!';
  return '🔥';
}

function visibleNodeCopy(node: RunNode) {
  const target = encounterTarget(node);
  if (node.type === 'normal_round') return {
    label: `R${formatPlayerNumber(chapterRoundForRound(node.round))}`,
    detail: target === null ? null : `Goal ${formatPlayerNumber(target)}`,
  };
  if (node.type === 'shop') return {
    label: 'SHOP',
    detail: `Prepare for R${formatPlayerNumber(chapterRoundForRound(node.round))}`,
  };
  if (node.type === 'mini_boss_round') return {
    label: 'MINI-BOSS',
    detail: node.boss ? BOSSES[node.boss].name : null,
  };
  if (node.type === 'special_offer') return { label: 'SPECIAL OFFER', detail: 'Midpoint reward' };
  if (node.type === 'boss_round') return {
    label: 'BOSS',
    detail: node.boss ? BOSSES[node.boss].name : null,
  };
  return { label: 'FLAME', detail: 'Boss reward' };
}

function accessibleNodeLabel(node: RunNode, chapterNumber: number, state: MapNodeState) {
  const target = encounterTarget(node);
  const stateLabel = state === 'current' ? 'current' : state;
  if (node.type === 'normal_round') {
    return `Chapter ${chapterNumber} Round ${chapterRoundForRound(node.round)}, ${stateLabel}${target === null ? '' : `, Goal ${formatPlayerNumber(target)}`}`;
  }
  if (node.type === 'shop') {
    return `Shop after Chapter ${chapterNumber} Round ${Math.max(1, chapterRoundForRound(node.round) - 1)}, ${stateLabel}`;
  }
  if (node.type === 'mini_boss_round') {
    return `Chapter ${chapterNumber} Mini-Boss${node.boss ? `, ${BOSSES[node.boss].name}` : ''}, ${stateLabel}${target === null ? '' : `, Goal ${formatPlayerNumber(target)}`}`;
  }
  if (node.type === 'special_offer') return `Special Offer midpoint reward, ${stateLabel}`;
  if (node.type === 'boss_round') {
    return `Chapter ${chapterNumber} Boss${node.boss ? `, ${BOSSES[node.boss].name}` : ''}, ${stateLabel}${target === null ? '' : `, Goal ${formatPlayerNumber(target)}`}`;
  }
  return `Flame Selection reward after Chapter ${chapterNumber} Boss, ${stateLabel}`;
}

export function RunMapTransition({ seed, event, onContinue }: { seed: string; event: GameEvent; onContinue: () => void }) {
  const [countdown, setCountdown] = useState(MAP_AUTO_CONTINUE_SECONDS);
  const [exiting, setExiting] = useState(false);
  const reducedMotion = useReducedMotion();
  const continued = useRef(false);
  const exitingRef = useRef(false);
  const exitTimeoutRef = useRef<number | null>(null);
  const onContinueRef = useRef(onContinue);
  const reducedMotionRef = useRef(reducedMotion);
  onContinueRef.current = onContinue;
  reducedMotionRef.current = reducedMotion;
  const continueOnce = () => {
    if (continued.current) return;
    continued.current = true;
    onContinueRef.current();
  };
  const beginContinue = () => {
    if (continued.current || exitingRef.current) return;
    if (reducedMotionRef.current) { continueOnce(); return; }
    exitingRef.current = true;
    setExiting(true);
    exitTimeoutRef.current = window.setTimeout(continueOnce, MAP_EXIT_MS);
  };
  useEffect(() => {
    const deadline = performance.now() + MAP_AUTO_CONTINUE_MS;
    setCountdown(MAP_AUTO_CONTINUE_SECONDS);
    const interval = window.setInterval(() => {
      setCountdown(Math.max(1, Math.ceil((deadline - performance.now()) / 1000)));
    }, 100);
    const timeout = window.setTimeout(beginContinue, MAP_AUTO_CONTINUE_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      if (exitTimeoutRef.current !== null) window.clearTimeout(exitTimeoutRef.current);
    };
  }, [event.id]);

  const destination = event.toNode ?? '';
  const destinationRound = Number(destination.match(/\d+/)?.[0] ?? event.round);
  const chapterNumber = chapterNumberForRound(destinationRound);
  const plan = event.board.chapterPlans[chapterNumber];
  const nodes = routeWindow(seed, destination, 2, plan);
  const destinationIndex = nodes.findIndex(node => node.id === destination);
  // The inter-Chapter Shop precedes the next route's R1 and is intentionally not a Chapter node.
  // Anchor that preview at the route start so every board still has one clear focal point.
  const currentIndex = destinationIndex >= 0 ? destinationIndex : 0;
  const fromIndex = nodes.findIndex(node => node.id === event.fromNode);
  const activeSegmentIndex = fromIndex >= 0 && Math.abs(fromIndex - currentIndex) === 1
    ? Math.min(fromIndex, currentIndex) : -1;
  const miniBossColor = SCREEN_THEMES[plan?.miniBoss ?? 'round'].accent;
  const bossColor = SCREEN_THEMES[plan?.boss ?? 'round'].accent;

  return <Paper className={`run-map-transition ${event.boss ? 'boss-reveal' : ''} ${exiting ? 'map-exiting' : ''}`}
    data-testid="run-map-transition" data-destination={destination} role="status" aria-live="polite"
    style={{ '--map-exit-duration': `${MAP_EXIT_MS}ms`, '--chapter-mini': miniBossColor,
      '--chapter-boss': bossColor } as React.CSSProperties}>
    <div className="map-toolbar">
      <div className="map-kicker">CHAPTER {chapterNumber}</div>
      <div className="map-continue" style={{ '--map-auto-continue-duration': `${MAP_AUTO_CONTINUE_MS}ms` } as React.CSSProperties}>
        <span className="map-continue-fill" aria-hidden="true" />
        <Button size="sm" variant="transparent" className="map-continue-button" onClick={beginContinue} aria-label="Continue"
          title={`Automatically continues in ${countdown} second${countdown === 1 ? '' : 's'}`}>
          <span>Continue</span><span className="map-continue-countdown" aria-hidden="true">{countdown}</span>
        </Button>
      </div>
    </div>

    <div className="run-map-track" aria-label={`Chapter ${chapterNumber} route`} data-testid="run-map-track" data-chapter={chapterNumber}
      data-tutorial="chapter-map" data-current-node={nodes[currentIndex]?.id}>
      <svg className="chapter-map-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {ROUTE_SEGMENTS.map((path, index) => {
          const rewardConnector = index === ROUTE_SEGMENTS.length - 1;
          const complete = index < currentIndex;
          const active = index === activeSegmentIndex;
          const progress = index / (ROUTE_SEGMENTS.length - 2);
          const miniWeight = Math.round((1 - Math.min(1, progress)) * 100);
          const arcColor = rewardConnector ? '#EF4444' : `color-mix(in srgb, ${miniBossColor} ${miniWeight}%, ${bossColor})`;
          return <path key={path} d={path} pathLength="1"
            className={`map-route-segment ${rewardConnector ? 'reward-connector' : ''} ${complete ? 'completed' : 'upcoming'} ${active ? `route-active route-${event.direction ?? 'forward'}` : ''}`}
            data-segment-index={index} data-testid={active ? 'active-map-connector' : undefined}
            style={{ '--segment-color': arcColor } as React.CSSProperties} />;
        })}
      </svg>

      <span className="map-start-label" aria-hidden="true">START</span>
      <span className="map-boss-label" aria-hidden="true">CHAPTER BOSS</span>
      <div className="chapter-map-nodes" role="list">
        {nodes.map((node, index) => {
          const point = CHAPTER_MAP_POINTS[index];
          if (!point) return null;
          const state = chapterMapNodeState(index, currentIndex);
          const progress = index / Math.max(1, nodes.length - 2);
          const miniWeight = Math.round((1 - Math.min(1, progress)) * 100);
          const arcColor = node.type === 'special_offer' ? '#2ED68F'
            : node.type === 'flame_selection' ? '#EF4444'
              : `color-mix(in srgb, ${miniBossColor} ${miniWeight}%, ${bossColor})`;
          const copy = visibleNodeCopy(node);
          return <div key={node.id} className={`run-map-stop row-${point.row} align-${point.align} is-${state}`}
            role="listitem" data-testid={`chapter-map-node-${index}`} data-node-id={node.id} data-node-kind={node.type}
            data-node-label={nodeLabel(node)} data-node-index={index} data-row={point.row} data-state={state}
            data-map-x={point.x} data-map-y={point.y} data-attached-to={node.type === 'flame_selection' ? 'boss' : undefined}
            style={{ left: `${point.x}%`, top: `${point.y}%`, '--node-arc-color': arcColor } as React.CSSProperties}>
            <div className={`run-map-node node-${node.type}`} aria-current={state === 'current' ? 'step' : undefined}
              aria-label={accessibleNodeLabel(node, chapterNumber, state)} title={accessibleNodeLabel(node, chapterNumber, state)}
              data-tutorial={state === 'current' ? 'chapter-map-current' : undefined}>
              {(state !== 'current' || node.type !== 'normal_round') &&
                <span className="node-glyph" aria-hidden="true">{compactGlyph(node)}</span>}
              {state === 'current' && <span className="current-node-copy">
                <span className="node-label">{copy.label}</span>
                {copy.detail && <span className="node-target">{copy.detail}</span>}
              </span>}
            </div>
          </div>;
        })}
      </div>
    </div>
  </Paper>;
}
