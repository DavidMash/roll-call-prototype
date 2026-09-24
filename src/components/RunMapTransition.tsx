import { Button, Paper, Text } from '@mantine/core';
import { BOSSES } from '../game/bosses';
import { nodeDescription, nodeLabel, routeWindow } from '../game/progression';
import type { GameEvent } from '../game/types';

export function RunMapTransition({ seed, event, onSkip }: { seed: string; event: GameEvent; onSkip: () => void }) {
  const destination = event.toNode ?? '';
  const nodes = routeWindow(seed, destination);
  const boss = event.boss ? BOSSES[event.boss] : null;
  const destinationNode = nodes.find(node => node.id === destination);
  return <Paper className={`run-map-transition ${event.boss ? 'boss-reveal' : ''}`} data-testid="run-map-transition"
    data-destination={destination} role="status" aria-live="polite">
    <div className="map-kicker">{event.direction === 'backward' ? 'FALL BACK' : 'ROUTE ADVANCE'}</div>
    <div className="run-map-track" aria-label="Local run route">
      {nodes.map((node, index) => <div className="run-map-segment" key={node.id}>
        {index > 0 && <span className="map-connector" aria-hidden="true" />}
        <div className={`run-map-node node-${node.type} ${node.id === destination ? 'destination' : ''}`}
          title={nodeDescription(node)} aria-current={node.id === destination ? 'step' : undefined}>
          <span className="node-glyph">{node.type === 'shop' ? '¤' : node.type === 'flame_selection' ? '◆' : node.type === 'boss_round' ? '!' : '•'}</span>
          <span>{nodeLabel(node)}</span>
        </div>
      </div>)}
    </div>
    <div className="map-arrival">
      <Text size="xs" fw={800} tt="uppercase" lts=".14em">Arriving at</Text>
      <Text fw={950} size="xl">{boss?.name ?? (destinationNode ? nodeDescription(destinationNode) : destination)}</Text>
      {boss && <Text size="sm">{boss.shortRule}</Text>}
    </div>
    <Button size="compact-xs" variant="subtle" color="gray" className="map-skip" onClick={onSkip}>Skip</Button>
  </Paper>;
}
