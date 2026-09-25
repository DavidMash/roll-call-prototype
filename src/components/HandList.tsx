import { Badge, Button, Group, Text, Tooltip } from '@mantine/core';
import { combinationsForHand, handStats, HANDS, LOWER_HAND_IDS, ultimateHands, UPPER_HAND_IDS } from '../game/hands';
import { activeFlameId, activeFlameInvestment, wellTrainedMultiplier } from '../game/flames';
import type { Selection } from '../game/selection';
import type { Board, HandId } from '../game/types';
import { activeEncounterDice, requiredEncounterDieIds, unavailableEncounterHands } from '../game/bosses';

function ScorecardSection({ title, hands, board, selection, busy, onSelect }: {
  title: string; hands: HandId[]; board: Board; selection: Selection; busy: boolean; onSelect: (hand: HandId) => void;
}) {
  const encounterDice = activeEncounterDice(board);
  const unavailableHands = unavailableEncounterHands(board);
  const requiredDieIds = requiredEncounterDieIds(board);
  const ultimate = new Set(ultimateHands(board.handLevels));
  return <section className="scorecard-section" aria-labelledby={`scorecard-${title.toLowerCase()}`}>
    <Text id={`scorecard-${title.toLowerCase()}`} className="scorecard-section-title" size="xs" fw={700} tt="uppercase">{title}</Text>
    <div className="scorecard-rows">
      {hands.map(hand => {
        const definition = HANDS[hand];
        const stats = handStats(hand, board.handLevels[hand]);
        const consumed = unavailableHands.includes(hand);
        const cooldown = board.boss?.type === 'marathon' ? board.boss.cooldowns[hand] ?? 0 : 0;
        const quickdrawLocked = board.boss?.type === 'quickdraw' && board.boss.lowerShotUsed && LOWER_HAND_IDS.includes(hand);
        const compatible = combinationsForHand(encounterDice, hand)
          .some(set => selection.dieIds.every(dieId => set.includes(dieId)) && requiredDieIds.every(dieId => set.includes(dieId)));
        const playable = !consumed && compatible;
        const selected = selection.hand === hand;
        const targeted = board.targetPracticeHand === hand;
        const selectedWellTrained = selected ? selection.dieIds.find(id => activeFlameId(board.dice.find(die => die.id === id)?.flame) === 'wellTrained') : undefined;
        const wellTrained = board.bonfires.includes('wellTrained') ? wellTrainedMultiplier(100, board.handPlayCounts[hand])
          : selectedWellTrained === undefined ? 1 : wellTrainedMultiplier(activeFlameInvestment(board.dice.find(die => die.id === selectedWellTrained)?.flame), board.handPlayCounts[hand]);
        const showWellTrained = selected && (board.bonfires.includes('wellTrained') || selectedWellTrained !== undefined);
        const hotTarget = board.hotStreakGoal === hand;
        const isUltimate = ultimate.has(hand);
        const score = board.scoreByHand[hand];
        const state = consumed ? 'consumed' : selected ? 'selected' : playable ? 'playable' : 'unavailable';
        const scoreLabel = score === undefined ? 'no score' : `${score} points`;
        return <Button key={hand} variant={selected ? 'light' : 'subtle'} color={selected ? 'teal' : 'gray'}
          className={`scorecard-row ${state} ${targeted ? 'targeted' : ''} ${board.boss?.type === 'caller' && board.boss.calledHand === hand ? 'caller-called' : ''} ${board.boss?.type === 'fly' && board.boss.flyHand === hand ? 'fly-row' : ''}`} data-testid={`scorecard-row-${hand}`} data-state={state}
          disabled={busy || !playable} onClick={() => onSelect(hand)} aria-pressed={selected}
          aria-label={`${definition.name} · Lv. ${stats.level} ${stats.basePips} Pips · ×${stats.baseMultiplier}${isUltimate ? ' · Ultimate Hand' : ''} ${scoreLabel}${consumed ? ' used' : ''}`}>
          <span className="scorecard-row-copy">
            <span className="scorecard-hand-name">{targeted && <span className="target-marker" title="Target Practice target">◎ TARGET </span>}{hotTarget && <span className="target-marker" title="Hot Streak goal">🔥 NEXT </span>}{board.boss?.type === 'fly' && board.boss.flyHand === hand && <span className="fly-marker" title="The Fly is here">● FLY </span>}{definition.name} <span>· Lv. {stats.level}</span></span>
            {isUltimate && <Tooltip label="One of your three highest-ranked hands. Hand level ranks first, then trained scoring strength." multiline maw={300} withArrow>
              <Badge className="ultimate-badge" size="xs" color="grape" variant="light" data-testid={`ultimate-badge-${hand}`}>ULTIMATE</Badge>
            </Tooltip>}
            <Tooltip label={`${stats.basePips} Base Pips · ×${stats.baseMultiplier} Base Mult`} position="right" withArrow>
              <span className="scorecard-base" data-testid={`scorecard-stats-${hand}`}>{stats.basePips} · ×{stats.baseMultiplier}</span>
            </Tooltip>
            {showWellTrained && <span className="well-trained-preview" data-testid={`well-trained-preview-${hand}`}>WELL TRAINED ×{Number(wellTrained.toFixed(4))}</span>}
          </span>
          <span className="scorecard-row-result">
            <span data-testid={`scorecard-score-${hand}`}>{score ?? '—'}</span>
            {cooldown > 0 ? <Badge size="xs" color="orange" variant="light">COOLDOWN {cooldown}</Badge>
              : quickdrawLocked ? <Badge size="xs" color="yellow" variant="light">LOCKED</Badge>
              : consumed && <Badge size="xs" color="gray" variant="light">used</Badge>}
          </span>
        </Button>;
      })}
    </div>
  </section>;
}

export function HandScorecard({ board, selection, busy, canClear = selection.dieIds.length > 0, onSelect, onClear }: {
  board: Board; selection: Selection; busy: boolean; canClear?: boolean; onSelect: (hand: HandId) => void; onClear: () => void;
}) {
  const encounterDice = activeEncounterDice(board);
  const unavailableHands = unavailableEncounterHands(board);
  const requiredDieIds = requiredEncounterDieIds(board);
  const hasCompatibleHand = [...UPPER_HAND_IDS, ...LOWER_HAND_IDS].some(hand => !unavailableHands.includes(hand)
    && combinationsForHand(encounterDice, hand).some(set => selection.dieIds.every(id => set.includes(id))
      && requiredDieIds.every(id => set.includes(id))));
  return <div className="scorecard">
    <Group justify="space-between" className="scorecard-header">
      <Text fw={700} size="sm" tt="uppercase" lts=".08em">Scorecard</Text>
      <Button size="compact-xs" variant="subtle" color="gray" onClick={onClear} disabled={busy || !canClear}>Clear selection</Button>
    </Group>
    <div className="scorecard-grid">
      <ScorecardSection title="Upper" hands={UPPER_HAND_IDS} {...{ board, selection, busy, onSelect }} />
      <ScorecardSection title="Lower" hands={LOWER_HAND_IDS} {...{ board, selection, busy, onSelect }} />
    </div>
    {selection.dieIds.length > 0 && !hasCompatibleHand && <Text size="xs" c="orange" className="scorecard-hint">
      {board.boss?.type === 'hexer' ? 'No available hand includes the Cursed Die.' : 'No available hand contains all selected dice.'}
    </Text>}
    <div className="scorecard-totals" aria-label="Round score breakdown">
      <Group gap="xs"><Text size="xs" c="dimmed">Effects</Text><Text size="sm" fw={600} data-testid="scorecard-effect-score">{board.effectScore}</Text></Group>
      <Group gap="xs"><Text size="xs" c="dimmed">Total</Text><Text size="sm" fw={700} data-testid="scorecard-round-total">{board.score} / {board.target}</Text></Group>
    </div>
  </div>;
}
