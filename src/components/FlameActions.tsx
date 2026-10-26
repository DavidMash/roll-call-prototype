import { Button, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { activeFace } from '../game/dice';
import { validateAction } from '../game/engine';
import {
  burnItDownChargeGain, dareDevilMultiplier, flameByType, FLAMES, greaseTheEngineChargeGain,
  greaseTheEngineCost, lightningStrikeChargeGain,
  allInMultiplier,
} from '../game/flames';
import { activeEncounterDice } from '../game/bosses';
import { exactRatioNumber } from '../game/scoreMath';
import { usableManualRerolls } from '../game/specialOffers';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import type { Action, Board, Flame, Rank } from '../game/types';
import { DieNumberSelector } from './DieNumberSelector';

const COMMAND_FLAMES = ['burnItDown', 'greaseTheEngine', 'lightningStrike', 'dareDevil', 'allIn'] as const satisfies readonly Flame[];

function ActionCard({ name, explanation, status, actionLabel, disabledReason, onAction, testId }: {
  name: string; explanation: string; status: string; actionLabel: string; disabledReason: string | null;
  onAction: () => void; testId: string;
}) {
  return <Paper withBorder p="sm" className="flame-action-card" data-testid={testId}>
    <Stack gap={5}>
      <Group justify="space-between" align="start" wrap="nowrap">
        <Text fw={900}>{name}</Text><Text size="xs" c="orange" fw={800}>{status}</Text>
      </Group>
      <Text size="sm">{explanation}</Text>
      {disabledReason && <Text size="xs" c="dimmed" role="status">{disabledReason}</Text>}
      <Button size="compact-sm" disabled={disabledReason !== null} onClick={onAction}>{actionLabel}</Button>
    </Stack>
  </Paper>;
}

export function FlameActions({ board, busy, submit, onOpenChange }: {
  board: Board; busy: boolean; submit: (action: Action) => void; onOpenChange?: (opened: boolean) => void;
}) {
  const owned = COMMAND_FLAMES.filter(id => flameByType(board, id));
  const [opened, setOpened] = useState(false);
  const [lightningOpen, setLightningOpen] = useState(false);
  const [lightningDieId, setLightningDieId] = useState<number | null>(null);
  const [predictedFace, setPredictedFace] = useState<Exclude<Rank, 7>>(1);
  if (!owned.length) return null;

  const burn = flameByType(board, 'burnItDown');
  const burnFraction = board.target > 0n ? Math.max(0, Math.min(1, exactRatioNumber(board.score, board.target))) : 0;
  const burnRequested = burnItDownChargeGain(burn?.investedGold ?? 0, burnFraction);
  const availableCharge = Math.max(0, board.maxCharge - board.chargeXMult);
  const burnGain = Math.min(burnRequested, availableCharge);
  const burnAction: Action = { type: 'ACTIVATE_BURN_IT_DOWN' };
  const grease = flameByType(board, 'greaseTheEngine');
  const greaseCost = greaseTheEngineCost(board.interactiveFlames.greaseTheEngineUses);
  const greaseGain = Math.min(greaseTheEngineChargeGain(grease?.investedGold ?? 0), availableCharge);
  const greaseAction: Action = { type: 'ACTIVATE_GREASE_THE_ENGINE' };
  const lightning = flameByType(board, 'lightningStrike');
  const lightningGain = Math.min(lightningStrikeChargeGain(lightning?.investedGold ?? 0), availableCharge);
  const rerollsAvailable = usableManualRerolls(board);
  const lightningDice = activeEncounterDice(board);
  const lightningAction: Action | null = lightningDieId === null ? null
    : { type: 'ACTIVATE_LIGHTNING_STRIKE', dieId: lightningDieId, predictedFace };
  const lightningReason = lightningAction ? validateAction(board, lightningAction)
    : validateAction(board, { type: 'ACTIVATE_LIGHTNING_STRIKE', dieId: lightningDice[0]?.id ?? Number.NaN, predictedFace });
  const dare = flameByType(board, 'dareDevil');
  const dareCount = board.interactiveFlames.dareDevilCount;
  const dareFactor = dareDevilMultiplier(dare?.investedGold ?? 0, dareCount);
  const nextDareFactor = dareDevilMultiplier(dare?.investedGold ?? 0, dareCount + 1);
  const dareAction: Action = { type: 'ACTIVATE_DARE_DEVIL' };
  const allIn = flameByType(board, 'allIn');
  const allInFactor = allInMultiplier(allIn?.investedGold ?? 0);
  const allInAction: Action = { type: 'ARM_ALL_IN' };

  function changeOpened(next: boolean) {
    setOpened(next);
    onOpenChange?.(next);
  }

  function dispatchAndClose(action: Action) {
    submit(action);
    changeOpened(false);
    setLightningOpen(false);
    setLightningDieId(null);
  }

  return <>
    <Button size="compact-xs" variant="light" color="orange" disabled={busy}
      onClick={() => changeOpened(true)} data-testid="flame-actions-trigger">FLAME ACTIONS</Button>
    <Modal opened={opened} onClose={() => { changeOpened(false); setLightningOpen(false); setLightningDieId(null); }}
      title={lightningOpen ? 'LIGHTNING STRIKE' : 'FLAME ACTIONS'} centered className="flame-actions-modal">
      {lightningOpen ? <Stack gap="sm" data-testid="lightning-strike-flow">
        <Text size="sm">Choose one die and predict its final face. Confirming immediately spends one canonical Manual Reroll.</Text>
        <div className="lightning-die-options" role="group" aria-label="Choose Lightning Strike die">
          {lightningDice.map(die => {
            const playerDice = board.dice.filter(item => item.owner === 'player');
            const slot = die.owner === 'player' ? playerDice.findIndex(item => item.id === die.id) : -1;
            return <Button key={die.id} size="compact-sm" variant={lightningDieId === die.id ? 'filled' : 'default'}
              aria-pressed={lightningDieId === die.id} onClick={() => setLightningDieId(die.id)}>
              {die.owner === 'boss' ? 'CURSED' : `D${slot + 1}`} · FACE {activeFace(die).rank}
            </Button>;
          })}
        </div>
        <DieNumberSelector label="Predicted Face" value={predictedFace} onChange={setPredictedFace}
          testId="lightning-prediction-selector" />
        <Text size="xs" c="dimmed">Correct prediction: +{formatPlayerNumber(lightningGain)} Charge</Text>
        {lightningAction && validateAction(board, lightningAction) && <Text size="xs" c="dimmed" role="status">
          {validateAction(board, lightningAction)}
        </Text>}
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={() => { setLightningOpen(false); setLightningDieId(null); }}>CANCEL</Button>
          <Button disabled={!lightningAction || validateAction(board, lightningAction) !== null}
            onClick={() => lightningAction && dispatchAndClose(lightningAction)} data-testid="confirm-lightning-strike">
            PREDICT {predictedFace} · REROLL
          </Button>
        </Group>
      </Stack> : <Stack gap="xs" data-testid="flame-actions-list">
        {burn && <ActionCard name={FLAMES.burnItDown.name}
          explanation={`Sacrifice ${formatExactScore(board.score)} Score (${formatPlayerNumber(burnFraction * 100)}% of the Round Target).`}
          status={`+${formatPlayerNumber(burnGain)} Charge`} actionLabel="SACRIFICE SCORE"
          disabledReason={validateAction(board, burnAction)} onAction={() => dispatchAndClose(burnAction)} testId="flame-action-burn-it-down" />}
        {grease && <ActionCard name={FLAMES.greaseTheEngine.name}
          explanation={`Pay ${greaseCost} Gold now. The next bribe costs ${greaseCost * 2} Gold.`}
          status={`+${formatPlayerNumber(greaseGain)} Charge`} actionLabel={`PAY ${greaseCost}G`}
          disabledReason={validateAction(board, greaseAction)} onAction={() => dispatchAndClose(greaseAction)} testId="flame-action-grease-the-engine" />}
        {lightning && <ActionCard name={FLAMES.lightningStrike.name}
          explanation={`Predict one die's next Manual Reroll. ${rerollsAvailable} Reroll${rerollsAvailable === 1 ? '' : 's'} available.`}
          status={`HIT: +${formatPlayerNumber(lightningGain)} Charge`} actionLabel="CHOOSE PREDICTION"
          disabledReason={lightningReason} onAction={() => setLightningOpen(true)} testId="flame-action-lightning-strike" />}
        {dare && <ActionCard name={FLAMES.dareDevil.name}
          explanation={`Roll every available player die. Current stored payoff: ×${formatPlayerNumber(dareFactor)}.`}
          status={`DARE ${dareCount}/4 · NEXT ×${formatPlayerNumber(nextDareFactor)}`} actionLabel="DARE DEVIL"
          disabledReason={validateAction(board, dareAction)} onAction={() => dispatchAndClose(dareAction)} testId="flame-action-dare-devil" />}
        {allIn && <ActionCard name={FLAMES.allIn.name}
          explanation={board.scoreWagers.allInArmed
            ? "Armed. Your next manual Play receives this XMult; if it does not clear the Round, that package's Score is removed."
            : "Arm your next manual Play. Failure removes that Play's Score and directly caused Free Play Score."}
          status={board.scoreWagers.allInArmed ? `ARMED · NEXT MANUAL PLAY ×${formatPlayerNumber(allInFactor)}`
            : `NEXT MANUAL PLAY ×${formatPlayerNumber(allInFactor)}`}
          actionLabel={board.scoreWagers.allInArmed ? 'ALL IN ARMED' : 'ARM ALL IN'}
          disabledReason={validateAction(board, allInAction)} onAction={() => dispatchAndClose(allInAction)} testId="flame-action-all-in" />}
      </Stack>}
    </Modal>
  </>;
}
