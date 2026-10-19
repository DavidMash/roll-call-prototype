import { Button, Group, Modal, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { diminishingHalfChance, enhancementSellValue, ENHANCEMENTS, ENHANCEMENT_IDS, faceEnhancementTypes, furnaceMultiplier, tankMultiplierFactor } from '../game/enhancements';
import type { Action, Board, Enhancement, Rank } from '../game/types';
import type { DiceDisplay } from '../uiSettings';
import { formatPercentage, formatPlayerNumber } from '../game/copy';
import { PipFace } from './PipFace';
import { enhancementAccessibleName, EnhancementIdentity, EnhancementSymbol } from './EnhancementIdentity';
import { EnhancementSellButton } from './EnhancementSellButton';

export interface FaceDetailsTarget { dieId: number; face: Rank }
interface SaleTarget { enhancement: Enhancement; stacks: number }

export function FaceDetailsModal({ board, target, diceDisplay, busy, actionsEnabled, onClose, submit }: {
  board: Board;
  target: FaceDetailsTarget | null;
  diceDisplay: DiceDisplay;
  busy: boolean;
  actionsEnabled: boolean;
  onClose: () => void;
  submit: (action: Action) => void;
}) {
  const [focusedFace, setFocusedFace] = useState<Rank>(1);
  const [saleTarget, setSaleTarget] = useState<SaleTarget | null>(null);
  const die = target ? board.dice.find(item => item.id === target.dieId) ?? null : null;
  useEffect(() => {
    if (target) setFocusedFace(target.face);
    setSaleTarget(null);
  }, [target?.dieId, target?.face]);
  if (!die) return null;
  const currentDie = die;
  const rosterSlot = board.dice.filter(item => item.owner === 'player').findIndex(item => item.id === die.id);
  const dieCode = `D${rosterSlot + 1}`;
  const face = die.faces[focusedFace - 1];
  const ids = ENHANCEMENT_IDS.filter(id => (face.enhancements[id] ?? 0) > 0);
  const shopActions = board.phase === 'shop' && actionsEnabled;
  const saleProceeds = saleTarget ? enhancementSellValue(face, saleTarget.enhancement) : null;
  function requestSale(enhancement: Enhancement) {
    setSaleTarget({ enhancement, stacks: face.enhancements[enhancement]! });
  }
  function confirmSale() {
    if (!saleTarget) return;
    submit({ type: 'SELL_ENHANCEMENT', dieId: currentDie.id, face: focusedFace, enhancement: saleTarget.enhancement });
    setSaleTarget(null);
  }

  return <>
    <Modal opened={target !== null} onClose={onClose}
      title={board.phase === 'shop' ? `${dieCode} — MANAGE DIE` : `${dieCode} · FACE ${focusedFace}`}
      size="lg" centered transitionProps={{ duration: 0 }} data-testid="face-details-modal">
      <Stack gap="sm">
        {board.phase === 'shop' && <SimpleGrid cols={{ base: 3, sm: 6 }} spacing="xs" className="manage-face-grid" aria-label={`Faces on ${dieCode}`}>
          {die.faces.map((candidate, index) => {
            const physicalFace = index + 1 as Rank;
            const faceIds = ENHANCEMENT_IDS.filter(id => (candidate.enhancements[id] ?? 0) > 0);
            const typeCount = faceEnhancementTypes(candidate).length;
            const enhancementLabel = faceIds.map(id => enhancementAccessibleName(id, candidate.enhancements[id]!)).join(', ');
            const isFetchTarget = board.fetchTarget?.dieId === die.id && board.fetchTarget.physicalFace === physicalFace;
            return <Paper component="button" type="button" key={physicalFace} withBorder p="xs" data-testid={`manage-face-${physicalFace}`}
              className={`manage-face-tile ${focusedFace === physicalFace ? 'focused' : ''} ${die.value === physicalFace ? 'exposed-face' : ''}`}
              aria-label={`${dieCode} face ${physicalFace}${isFetchTarget ? ', Fetch target' : ''}${enhancementLabel ? `. Enhancements: ${enhancementLabel}` : '. No Enhancements'}`}
              aria-pressed={focusedFace === physicalFace} onClick={() => setFocusedFace(physicalFace)}>
              {diceDisplay === 'pips' ? <PipFace value={candidate.rank} compact label={`${dieCode} face ${physicalFace}`} />
                : <span className="manage-face-number" aria-label={`${dieCode} face ${physicalFace}`}>{candidate.rank}</span>}
              <strong>FACE {physicalFace}</strong>
              {die.value === physicalFace && <span className="manage-face-exposed">EXPOSED</span>}
              {isFetchTarget && <span className="manage-face-fetch">FETCH</span>}
              <small>LEGACY ENHANCEMENTS {typeCount}</small>
              <span className="manage-face-enhancements" data-testid={`manage-face-enhancements-${physicalFace}`}>
                {faceIds.map(id => <EnhancementSymbol key={id} enhancement={id} stacks={candidate.enhancements[id]!} decorative />)}
              </span>
            </Paper>;
          })}
        </SimpleGrid>}

        <div className="face-details-heading">
          <Text size="xs" fw={850} tt="uppercase" c="dimmed">{dieCode} · FACE {focusedFace}</Text>
          <Text fw={850}>Legacy Enhancements {faceEnhancementTypes(face).length}</Text>
        </div>
        <Stack gap="xs" className="face-detail-list">
          {ids.map(id => {
            const stacks = face.enhancements[id]!;
            const sellValue = enhancementSellValue(face, id);
            const dynamic = id === 'vintage' ? `Current sell value: ${formatPlayerNumber(sellValue)} Gold${face.vintageSommelierBoosted ? ' · Sommelier ×2' : ''}`
              : id === 'workout' && face.workoutPips > 0 ? `Current added Pips: ${formatPlayerNumber(face.workoutPips)}`
                : id === 'magnetic' && face.magneticSourceUsed ? 'Pull used this Round'
                  : id === 'personalTrainer' ? `Base training chance: ${formatPercentage(diminishingHalfChance(stacks))} before hand-level adjustment`
                    : id === 'doubleTime' ? `Score-twice chance: ${formatPercentage(diminishingHalfChance(stacks))}`
                      : id === 'tank' ? `Mult factor per scoring activation: ×${formatPlayerNumber(tankMultiplierFactor(stacks))}`
                        : id === 'furnace' ? `Current Mult factor: ×${formatPlayerNumber(furnaceMultiplier(face))}`
                          : id === 'flywheel' ? `${formatPlayerNumber(face.flywheelCharges ?? stacks)} free manual reroll charge${(face.flywheelCharges ?? stacks) === 1 ? '' : 's'} remaining this Round`
                            : id === 'sustainable' ? `${formatPlayerNumber(face.sustainableCharges ?? stacks)} hand-preservation charge${(face.sustainableCharges ?? stacks) === 1 ? '' : 's'} remaining this Round`
                              : id === 'boomerang' || id === 'holiday' ? `Chance: ${formatPercentage(diminishingHalfChance(stacks))}` : null;
            return <Paper key={id} withBorder p="sm" className="face-detail-item">
              <Group className="face-detail-item-layout" justify="space-between" align="flex-start" wrap="nowrap">
                <div className="face-detail-item-copy"><Text fw={800}><EnhancementIdentity enhancement={id} stacks={stacks} /></Text>
                  <Text size="sm" c="dimmed">{ENHANCEMENTS[id].description}</Text>{dynamic && <Text size="xs" c="teal" mt={3}>{dynamic}</Text>}</div>
                {shopActions && <EnhancementSellButton value={sellValue} disabled={busy}
                  ariaLabel={`Sell ${ENHANCEMENTS[id].name} from ${dieCode} face ${focusedFace} for ${sellValue} Gold`}
                  onClick={() => requestSale(id)} />}
              </Group>
            </Paper>;
          })}
        </Stack>
        <Group justify="space-between">
          <Button variant="default" onClick={onClose}>Close</Button>
        </Group>
      </Stack>
    </Modal>
    <Modal opened={saleTarget !== null} onClose={() => setSaleTarget(null)}
      title={saleTarget ? <span>SELL <EnhancementIdentity enhancement={saleTarget.enhancement} uppercase />?</span> : 'SELL ENHANCEMENT?'} centered transitionProps={{ duration: 0 }}>
      {saleTarget && saleProceeds !== null && <><Text fw={900} size="xl">+{formatPlayerNumber(saleProceeds)} GOLD</Text>
        <Text size="sm" c="dimmed">All {formatPlayerNumber(saleTarget.stacks)} stack{saleTarget.stacks === 1 ? '' : 's'} will be removed from Face {focusedFace}.</Text>
        <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setSaleTarget(null)}>CANCEL</Button>
          <EnhancementSellButton value={saleProceeds} variant="filled"
            ariaLabel={`Confirm sale of ${ENHANCEMENTS[saleTarget.enhancement].name} for ${saleProceeds} Gold`} onClick={confirmSale} /></Group></>}
    </Modal>
  </>;
}
