import { ActionIcon, Button, Group, Modal, Stack, Text } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activeFace, distinctDieOutcomes, outcomeIdentityKey } from '../game/dice';
import { validateAction } from '../game/engine';
import { flameByType, lightningStrikeChargeGain } from '../game/flames';
import { formatPlayerNumber } from '../game/copy';
import type { Action, Board, DieOutcomeIdentity, LightningStrikePrediction, MagicRerollChoice, Rank } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { Die } from './Die';

export function LightningStrikeModal({ board, dieIds, display, opened, onClose, onBack, magicChoices = [], submit }: {
  board: Board;
  dieIds: number[];
  display: DiceDisplay;
  opened: boolean;
  onClose: () => void;
  onBack?: () => void;
  magicChoices?: MagicRerollChoice[];
  submit: (action: Action) => void;
}) {
  const dice = useMemo(() => dieIds.flatMap(id => {
    const die = board.dice.find(candidate => candidate.id === id);
    return die ? [die] : [];
  }), [board.dice, dieIds.join(',')]);
  const [selected, setSelected] = useState<Record<number, DieOutcomeIdentity>>({});
  const predictionRow = useRef<HTMLDivElement>(null);
  const [scrollPosition, setScrollPosition] = useState({ before: false, after: false });
  const updateScrollPosition = useCallback(() => {
    const row = predictionRow.current;
    if (!row) return;
    const next = {
      before: row.scrollLeft > 2,
      after: row.scrollLeft + row.clientWidth < row.scrollWidth - 2,
    };
    setScrollPosition(current => current.before === next.before && current.after === next.after ? current : next);
  }, []);
  const attachPredictionRow = useCallback((row: HTMLDivElement | null) => {
    predictionRow.current = row;
    if (row) requestAnimationFrame(updateScrollPosition);
  }, [updateScrollPosition]);
  useEffect(() => {
    if (!opened) return;
    const magicByDie = new Map(magicChoices.map(choice => [choice.dieId, choice.outcome]));
    setSelected(Object.fromEntries(dice.map(die => {
      const outcomes = distinctDieOutcomes(die);
      const magic = magicByDie.get(die.id);
      if (magic && outcomes.some(outcome => outcomeIdentityKey(outcome) === outcomeIdentityKey(magic))) return [die.id, magic];
      const current = outcomes.find(outcome => outcome.kind === 'rank' && outcome.rank === activeFace(die).rank);
      return [die.id, current ?? outcomes[0]];
    }).filter((entry): entry is [number, DieOutcomeIdentity] => entry[1] !== undefined)));
  }, [opened, dice, magicChoices.map(choice => `${choice.dieId}:${outcomeIdentityKey(choice.outcome)}`).join('|')]);
  useEffect(() => {
    if (!opened) return;
    const row = predictionRow.current;
    if (!row) return;
    const frame = requestAnimationFrame(updateScrollPosition);
    const observer = new ResizeObserver(updateScrollPosition);
    observer.observe(row);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [dice.length, opened, updateScrollPosition]);

  const predictions: LightningStrikePrediction[] = dice.flatMap(die => selected[die.id]
    ? [{ dieId: die.id, outcome: selected[die.id] }] : []);
  const action: Action = { type: 'ACTIVATE_LIGHTNING_STRIKE', predictions,
    ...(magicChoices.length ? { magicChoices } : {}) };
  const reason = predictions.length === dice.length ? validateAction(board, action) : 'Choose one prediction for every die.';
  const roster = board.dice.filter(die => die.owner === 'player');
  const flame = flameByType(board, 'lightningStrike');
  const perHitFactor = lightningStrikeChargeGain(flame?.investedGold ?? 0);
  const maximumFactor = Number((perHitFactor ** dice.length).toFixed(12));
  const projectedCharge = Math.min(board.maxCharge, board.chargeXMult * maximumFactor);

  function cycle(dieId: number, direction: -1 | 1) {
    const die = dice.find(candidate => candidate.id === dieId);
    if (!die) return;
    const outcomes = distinctDieOutcomes(die);
    const currentKey = selected[dieId] ? outcomeIdentityKey(selected[dieId]) : '';
    const current = Math.max(0, outcomes.findIndex(outcome => outcomeIdentityKey(outcome) === currentKey));
    const next = outcomes[(current + direction + outcomes.length) % outcomes.length];
    if (next) setSelected(value => ({ ...value, [dieId]: next }));
  }

  return <Modal opened={opened} onClose={onClose} centered size="lg" className="lightning-prediction-modal"
    transitionProps={{ duration: 0 }}
    title={<Stack gap={0}><Text fw={900}>Lightning Strike</Text><Text size="sm" c="dimmed">Submit your prediction</Text></Stack>}
    closeButtonProps={{ 'aria-label': 'Close Lightning Strike prediction' }}>
    <Stack gap="md">
      <Text size="sm">Predict each selected die's resolved outcome. Every correct prediction multiplies Charge independently.</Text>
      <Text size="xs" c="orange" fw={700} role="status" data-testid="lightning-strike-stakes">
        EACH HIT ×{formatPlayerNumber(perHitFactor)} CHARGE · IF ALL {dice.length} HIT: ×{formatPlayerNumber(maximumFactor)} · CHARGE ×{formatPlayerNumber(board.chargeXMult)} → ×{formatPlayerNumber(projectedCharge)} MAX
      </Text>
      <div className={`lightning-prediction-scroll${scrollPosition.before ? ' has-more-before' : ''}${scrollPosition.after ? ' has-more-after' : ''}`}>
        <div ref={attachPredictionRow} className="lightning-prediction-row" data-testid="lightning-prediction-row"
          onScroll={updateScrollPosition}>
          {dice.map(die => {
          const outcome = selected[die.id];
          const physicalIndex = outcome?.kind === 'rank'
            ? die.faces.findIndex(face => face.rank === outcome.rank) : -1;
          const preview = { ...die, value: (physicalIndex >= 0 ? physicalIndex + 1 : die.value) as Rank };
          const slot = die.owner === 'player' ? roster.findIndex(candidate => candidate.id === die.id) : undefined;
          const label = die.owner === 'boss' ? 'Cursed Die' : `Die ${Number(slot) + 1}`;
          return <div className="lightning-prediction-die" key={die.id} data-testid={`lightning-prediction-${die.id}`}>
            <ActionIcon className="lightning-prediction-arrow" size={44} variant="subtle" color="orange" aria-label={`Next prediction for ${label}`}
              onClick={() => cycle(die.id, 1)}><IconChevronUp size={18} /></ActionIcon>
            <Die die={preview} rosterSlot={slot} display={display} selected={false} highlighted={false} rolling={false}
              roundRuntime={board.dieRoundState[die.id]}
              disabled detailsDisabled onClick={() => undefined} onDetails={() => undefined} />
            <ActionIcon className="lightning-prediction-arrow" size={44} variant="subtle" color="orange" aria-label={`Previous prediction for ${label}`}
              onClick={() => cycle(die.id, -1)}><IconChevronDown size={18} /></ActionIcon>
          </div>;
          })}
        </div>
      </div>
      <Group className="lightning-scroll-guidance" justify="space-between" gap="xs" wrap="nowrap"
        role="status" aria-live="polite" data-testid="lightning-scroll-guidance">
        <Text size="xs" fw={800}>{dice.length} {dice.length === 1 ? 'DIE' : 'DICE'} TO PREDICT</Text>
        {(scrollPosition.before || scrollPosition.after) && <Text size="xs" c="orange" fw={800}>
          {scrollPosition.after ? 'SWIPE FOR MORE DICE' : 'FINAL DIE REACHED'}
        </Text>}
      </Group>
      {reason && <Text size="xs" c="dimmed" role="status">{reason}</Text>}
      <Group justify="flex-end">{onBack && <Button variant="default" onClick={onBack}>BACK</Button>}
        <Button variant="subtle" color="gray" onClick={onClose}>CANCEL</Button>
        <Button color="orange" disabled={reason !== null} data-testid="confirm-lightning-strike"
          onClick={() => { if (reason === null) { submit(action); onClose(); } }}>ROLL DICE!</Button></Group>
    </Stack>
  </Modal>;
}
