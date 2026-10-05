import { Button, Paper } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { useEffect, useRef, useState } from 'react';
import { BOSSES } from '../game/bosses';
import { chapterNumberForRound, chapterRoundForRound } from '../game/chapters';
import { formatPlayerNumber } from '../game/copy';
import { nodeLabel, routeWindow } from '../game/progression';
import { SCREEN_THEMES } from '../game/screenThemes';
import type { GameEvent, RunNode } from '../game/types';

const MAP_AUTO_CONTINUE_SECONDS = 3;
const MAP_AUTO_CONTINUE_MS = MAP_AUTO_CONTINUE_SECONDS * 1000;
const MAP_EXIT_MS = 280;

type MapRow = 'bottom' | 'middle' | 'top';
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
  slot: number;
}

/** Twelve normalized board slots form three four-position bands. Slot 9 is an intentional gap. */
export const CHAPTER_MAP_SLOTS: readonly ChapterMapPoint[] = [
  { x: 10, y: 84, row: 'bottom', align: 'start', slot: 0 },
  { x: 37, y: 84, row: 'bottom', align: 'center', slot: 1 },
  { x: 63, y: 84, row: 'bottom', align: 'center', slot: 2 },
  { x: 90, y: 84, row: 'bottom', align: 'end', slot: 3 },
  { x: 90, y: 50, row: 'middle', align: 'end', slot: 4 },
  { x: 63, y: 50, row: 'middle', align: 'center', slot: 5 },
  { x: 37, y: 50, row: 'middle', align: 'center', slot: 6 },
  { x: 10, y: 50, row: 'middle', align: 'start', slot: 7 },
  { x: 10, y: 16, row: 'top', align: 'start', slot: 8 },
  { x: 37, y: 16, row: 'top', align: 'center', slot: 9 },
  { x: 63, y: 16, row: 'top', align: 'center', slot: 10 },
  { x: 90, y: 16, row: 'top', align: 'end', slot: 11 },
] as const;

const NODE_SLOT_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11] as const;
export const CHAPTER_MAP_POINTS: readonly ChapterMapPoint[] = NODE_SLOT_INDEXES.map(index => CHAPTER_MAP_SLOTS[index]);

const ROUTE_SEGMENTS = [
  'M 10 84 L 37 84',
  'M 37 84 L 63 84',
  'M 63 84 L 90 84',
  'M 90 84 C 98 84, 98 50, 90 50',
  'M 90 50 L 63 50',
  'M 63 50 L 37 50',
  'M 37 50 L 10 50',
  'M 10 50 C 2 50, 2 16, 10 16',
  'M 10 16 L 63 16',
  'M 63 16 L 90 16',
] as const;

function compactGlyph(node: RunNode) {
  if (node.type === 'normal_round') return formatPlayerNumber(chapterRoundForRound(node.round));
  if (node.type === 'shop') return '$';
  if (node.type === 'mini_boss_round') return '◆';
  if (node.type === 'boss_round') return '!';
  return '•';
}

function visibleNodeLabel(node: RunNode) {
  if (node.type === 'normal_round') return `R${formatPlayerNumber(chapterRoundForRound(node.round))}`;
  if (node.type === 'shop') return 'SHOP';
  if (node.type === 'mini_boss_round' || node.type === 'boss_round') return node.boss ? BOSSES[node.boss].name : nodeLabel(node);
  return nodeLabel(node);
}

function accessibleNodeLabel(node: RunNode, chapterNumber: number, state: MapNodeState) {
  const stateLabel = state === 'current' ? 'current destination' : state;
  if (node.type === 'normal_round') return `Chapter ${chapterNumber} Round ${chapterRoundForRound(node.round)}, ${stateLabel}`;
  if (node.type === 'shop') {
    return `Shop after Chapter ${chapterNumber} Round ${Math.max(1, chapterRoundForRound(node.round) - 1)}, ${stateLabel}`;
  }
  if (node.type === 'mini_boss_round') return `${node.boss ? BOSSES[node.boss].name : `Chapter ${chapterNumber}`} Mini-Boss, ${stateLabel}`;
  if (node.type === 'boss_round') return `${node.boss ? BOSSES[node.boss].name : `Chapter ${chapterNumber}`} Boss, ${stateLabel}`;
  return `${nodeLabel(node)}, ${stateLabel}`;
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
          <span>CONTINUE</span><span className="map-continue-countdown" data-testid="map-countdown" aria-hidden="true">{countdown}</span>
        </Button>
      </div>
    </div>

    <div className="run-map-track" aria-label={`Chapter ${chapterNumber} route`} data-testid="run-map-track" data-chapter={chapterNumber}
      data-tutorial="chapter-map" data-current-node={nodes[currentIndex]?.id} data-slot-count={CHAPTER_MAP_SLOTS.length}>
      <svg className="chapter-map-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {ROUTE_SEGMENTS.map((path, index) => {
          const complete = index < currentIndex;
          const active = index === activeSegmentIndex;
          const progress = index / Math.max(1, ROUTE_SEGMENTS.length - 1);
          const miniWeight = Math.round((1 - Math.min(1, progress)) * 100);
          const arcColor = `color-mix(in srgb, ${miniBossColor} ${miniWeight}%, ${bossColor})`;
          return <path key={path} d={path} pathLength="1"
            className={`map-route-segment ${complete ? 'completed' : 'upcoming'} ${active ? `route-active route-${event.direction ?? 'forward'}` : ''}`}
            data-segment-index={index} data-testid={active ? 'active-map-connector' : undefined}
            style={{ '--segment-color': arcColor } as React.CSSProperties} />;
        })}
      </svg>

      <div className="chapter-map-nodes" role="list">
        {nodes.map((node, index) => {
          const point = CHAPTER_MAP_POINTS[index];
          if (!point) return null;
          const state = chapterMapNodeState(index, currentIndex);
          const displayNode = state === 'current' && event.boss ? { ...node, boss: event.boss } : node;
          const progress = index / Math.max(1, nodes.length - 1);
          const miniWeight = Math.round((1 - Math.min(1, progress)) * 100);
          const arcColor = `color-mix(in srgb, ${miniBossColor} ${miniWeight}%, ${bossColor})`;
          return <div key={node.id} className={`run-map-stop row-${point.row} align-${point.align} is-${state}`}
            role="listitem" data-testid={`chapter-map-node-${index}`} data-node-id={node.id} data-node-kind={node.type}
            data-node-label={nodeLabel(node)} data-node-index={index} data-slot-index={point.slot} data-row={point.row} data-state={state}
            data-map-x={point.x} data-map-y={point.y} data-pulse={state === 'current' ? 'true' : undefined}
            style={{ left: `${point.x}%`, top: `${point.y}%`, '--node-arc-color': arcColor } as React.CSSProperties}>
            <div className={`run-map-node node-${node.type}`} aria-current={state === 'current' ? 'step' : undefined}
              aria-label={accessibleNodeLabel(displayNode, chapterNumber, state)} title={accessibleNodeLabel(displayNode, chapterNumber, state)}
              data-tutorial={state === 'current' ? 'chapter-map-current' : undefined}>
              {state !== 'current' && <span className="node-glyph" aria-hidden="true">{compactGlyph(node)}</span>}
              {state === 'current' && <span className="current-node-copy">
                <span className="node-label">{visibleNodeLabel(displayNode)}</span>
              </span>}
            </div>
          </div>;
        })}
      </div>
    </div>
  </Paper>;
}
