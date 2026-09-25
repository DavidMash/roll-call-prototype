import { Button, Paper, Text } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { useEffect, useRef, useState } from 'react';
import { BOSSES } from '../game/bosses';
import { nodeDescription, nodeLabel, routeWindow } from '../game/progression';
import type { GameEvent } from '../game/types';

const MAP_AUTO_CONTINUE_SECONDS = 3;
const MAP_AUTO_CONTINUE_MS = MAP_AUTO_CONTINUE_SECONDS * 1000;
const MAP_EXIT_MS = 280;

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
  const nodes = routeWindow(seed, destination);
  const boss = event.boss ? BOSSES[event.boss] : null;
  const destinationNode = nodes.find(node => node.id === destination);
  const leadingPlaceholders = Math.max(0, 2 - nodes.findIndex(node => node.id === destination));
  return <Paper className={`run-map-transition ${event.boss ? 'boss-reveal' : ''} ${exiting ? 'map-exiting' : ''}`} data-testid="run-map-transition"
    data-destination={destination} role="status" aria-live="polite"
    style={{ '--map-exit-duration': `${MAP_EXIT_MS}ms` } as React.CSSProperties}>
    <div className="map-kicker">{event.direction === 'backward' ? 'FALL BACK' : 'ROUTE ADVANCE'}</div>
    <div className="run-map-track" aria-label="Local run route">
      {Array.from({ length: leadingPlaceholders }, (_, index) => <span className="map-node-placeholder" key={`placeholder-${index}`} aria-hidden="true" />)}
      {nodes.map((node, index) => {
        const previousNode = nodes[index - 1];
        const joinsTravel = index > 0 && event.fromNode !== null && event.fromNode !== undefined
          && ((previousNode.id === event.fromNode && node.id === destination)
            || (previousNode.id === destination && node.id === event.fromNode));
        return <div className="run-map-segment" key={node.id}>
          {index > 0 && <span className={`map-connector ${joinsTravel ? `route-active route-${event.direction ?? 'forward'}` : ''}`}
            data-testid={joinsTravel ? 'active-map-connector' : undefined} aria-hidden="true" />}
          <div className={`run-map-node node-${node.type} ${node.id === destination ? 'destination' : ''}`}
            title={nodeDescription(node)} aria-current={node.id === destination ? 'step' : undefined}>
            <span className="node-glyph">{node.type === 'shop' ? '¤' : node.type === 'flame_selection' ? '◆' : node.type === 'boss_round' ? '!' : '•'}</span>
            <span>{nodeLabel(node)}</span>
          </div>
        </div>;
      })}
    </div>
    <div className="map-arrival">
      <Text size="xs" fw={800} tt="uppercase" lts=".14em">Arriving at</Text>
      <Text fw={950} size="xl">{boss?.name ?? (destinationNode ? nodeDescription(destinationNode) : destination)}</Text>
      {boss && <Text size="sm">{boss.shortRule}</Text>}
    </div>
    <div className="map-continue" style={{ '--map-auto-continue-duration': `${MAP_AUTO_CONTINUE_MS}ms` } as React.CSSProperties}>
      <span className="map-continue-fill" aria-hidden="true" />
      <Button size="sm" variant="transparent" className="map-continue-button" onClick={beginContinue} aria-label="Continue"
        title={`Automatically continues in ${countdown} second${countdown === 1 ? '' : 's'}`}>
        <span>Continue</span><span className="map-continue-countdown" aria-hidden="true">{countdown}</span>
      </Button>
    </div>
  </Paper>;
}
