import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import { validateAction } from '../game/engine';
import { dieEffectDescription } from '../game/diceEconomy';
import { SPECIAL_DICE } from '../game/specialDice';
import type { Action, Board, CollectibleDie } from '../game/types';

const commandTypes = new Set(['jumpingBean', 'chameleon', 'flywheel', 'magic', 'furnace']);

export function SpecialDiceControls({ board, busy, submit }: { board: Board; busy: boolean; submit: (action: Action) => void }) {
  const dice = board.dice.filter((die): die is CollectibleDie => die.owner === 'player' && die.type !== 'normal');
  if (!dice.length) return null;
  return <Paper p="xs" className="special-dice-controls" data-testid="special-dice-controls">
    <Text size="xs" fw={850} tt="uppercase" mb={5}>Special Dice</Text>
    <Stack gap={5}>{dice.map(die => {
      const runtime = board.dieRoundState[die.id];
      const definition = SPECIAL_DICE[die.type];
      const invocation = definition.invocationScale === 'level' && runtime
        ? `${runtime.invocationsRemaining} / ${die.level} Invocations` : null;
      const action = die.type === 'jumpingBean' ? { type: 'INVOKE_JUMPING_BEAN', dieId: die.id } as const
        : die.type === 'chameleon' ? { type: 'INVOKE_CHAMELEON', dieId: die.id } as const
          : die.type === 'flywheel' ? { type: 'INVOKE_FLYWHEEL', dieId: die.id } as const : null;
      return <div className="special-die-control" key={die.id} data-testid={`special-die-control-${die.id}`}>
        <Group justify="space-between" align="center" gap="xs" wrap="wrap">
          <div><Text size="sm" fw={800}>{definition.name} D6 · Lv{die.level}</Text>
            <Text size="xs" c="dimmed">{invocation ?? dieEffectDescription(die.type, die.level)}</Text></div>
          {action && <Button size="compact-xs" disabled={busy || validateAction(board, action) !== null} onClick={() => submit(action)}>ON COMMAND</Button>}
          {die.type === 'magic' && runtime && <Group gap={4}>
            {runtime.magicArmedFace !== null ? <><Text size="xs" fw={850} c="teal">ARMED: {runtime.magicArmedFace}</Text>
              <Button size="compact-xs" variant="default" disabled={busy} onClick={() => submit({ type: 'DISARM_MAGIC', dieId: die.id })}>DISARM</Button></>
              : ([1, 2, 3, 4, 5, 6] as const).map(face => {
                const magic: Action = { type: 'ARM_MAGIC', dieId: die.id, face };
                return <Button key={face} size="compact-xs" variant="default" disabled={busy || validateAction(board, magic) !== null}
                  aria-label={`Arm Magic die ${die.id} for face ${face}`} onClick={() => submit(magic)}>{face}</Button>;
              })}
          </Group>}
          {die.type === 'furnace' && runtime && <Group gap={6}><Text size="xs">{runtime.furnaceUnits} / 5 units · +{runtime.furnaceUnits * 3 * die.level} / +{15 * die.level} Pips · {board.gold} Gold</Text>
            <Button size="compact-xs" color="yellow" disabled={busy || validateAction(board, { type: 'FEED_FURNACE', dieId: die.id, amount: 1 }) !== null}
              onClick={() => submit({ type: 'FEED_FURNACE', dieId: die.id, amount: 1 })}>FEED 1 GOLD</Button></Group>}
          {!commandTypes.has(die.type) && die.type === 'freePlay' && runtime && <Text size="xs">
            Faces: {([1, 2, 3, 4, 5, 6] as const).map(face => `${face}:${Math.max(0, die.level - runtime.freePlayUsesByFace[face])}`).join(' · ')} left
          </Text>}
        </Group>
      </div>;
    })}</Stack>
  </Paper>;
}
