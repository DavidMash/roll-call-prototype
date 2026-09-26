import { Badge, Button, Text, Tooltip } from '@mantine/core';
import { combinationsForHand, handStats, HANDS, LOWER_HAND_IDS, ultimateHands, UPPER_HAND_IDS } from '../game/hands';
import { activeFlameId } from '../game/flames';
import type { Selection } from '../game/selection';
import type { Board, HandId } from '../game/types';
import { activeEncounterDice, requiredEncounterDieIds, unavailableEncounterHands } from '../game/bosses';

const MOBILE_HAND_NAMES: Partial<Record<HandId, string>> = {
  twoPair: 'Two Pair',
  threeKind: '3 of a Kind',
  smallStraight: 'Sm Straight',
  fullHouse: 'Full House',
  fourKind: '4 of a Kind',
  largeStraight: 'Lg Straight',
  fiveKind: '5 of a Kind',
};

function ScorecardSection({ title, hands, board, selection, busy, onSelect }: {
  title: string; hands: HandId[]; board: Board; selection: Selection; busy: boolean; onSelect: (hand: HandId) => void;
}) {
  const encounterDice = activeEncounterDice(board);
  const unavailableHands = unavailableEncounterHands(board);
  const requiredDieIds = requiredEncounterDieIds(board);
  const ultimate = new Set(ultimateHands(board.handLevels));
  const ownsUltimate = board.bonfires.includes('ultimate')
    || board.dice.some(die => activeFlameId(die.flame) === 'ultimate');
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
        const hotTarget = board.hotStreakGoal === hand;
        const isUltimate = ownsUltimate && ultimate.has(hand);
        const score = board.scoreByHand[hand];
        const state = consumed ? 'consumed' : selected ? 'selected' : playable ? 'playable' : 'unavailable';
        const scoreLabel = score === undefined ? 'no score' : `${score} points`;
        return <Button key={hand} variant={selected ? 'light' : 'subtle'} color={selected ? 'teal' : 'gray'}
          className={`scorecard-row ${state} ${targeted ? 'targeted' : ''} ${board.boss?.type === 'caller' && board.boss.calledHand === hand ? 'caller-called' : ''} ${board.boss?.type === 'fly' && board.boss.flyHand === hand ? 'fly-row' : ''}`} data-testid={`scorecard-row-${hand}`} data-state={state}
          disabled={busy || !playable} onClick={() => onSelect(hand)} aria-pressed={selected}
          aria-label={`${definition.name} · Lv. ${stats.level} ${stats.basePips} Pips · ×${stats.baseMultiplier}${isUltimate ? ' · Ultimate Hand' : ''} ${scoreLabel}${consumed ? ' used' : ''}`}>
          <span className="scorecard-row-copy">
            <span className="scorecard-hand-name" title={definition.name}>
              {targeted && <span className="target-marker" title="Target Practice target"><span className="wide-label">◎ TARGET </span><span className="compact-label">◎ </span></span>}
              {hotTarget && <span className="target-marker" title="Hot Streak goal"><span className="wide-label">🔥 NEXT </span><span className="compact-label">🔥 </span></span>}
              {board.boss?.type === 'fly' && board.boss.flyHand === hand && <span className="fly-marker" title="The Fly is here"><span className="wide-label">● FLY </span><span className="compact-label">● </span></span>}
              <span className="hand-name-full">{definition.name}</span><span className="hand-name-compact">{MOBILE_HAND_NAMES[hand] ?? definition.name}</span>
              <span className="hand-level"> · Lv. {stats.level}</span>
            </span>
            {isUltimate && <Tooltip label="One of your three highest-ranked hands. Hand level ranks first, then trained scoring strength." multiline maw={300} withArrow>
              <Badge className="ultimate-badge" size="xs" color="grape" variant="light" data-testid={`ultimate-badge-${hand}`}><span className="wide-label">ULTIMATE</span><span className="compact-label">U</span></Badge>
            </Tooltip>}
          </span>
          <span className="scorecard-row-result">
            <span data-testid={`scorecard-score-${hand}`}>{score ?? '—'}</span>
            {cooldown > 0 ? <Badge className="scorecard-state-badge" size="xs" color="orange" variant="light" title={`Cooldown ${cooldown}`}><span className="wide-label">COOLDOWN </span><span className="compact-label">CD </span>{cooldown}</Badge>
              : quickdrawLocked ? <Badge size="xs" color="yellow" variant="light">LOCKED</Badge>
              : consumed && <Badge size="xs" color="gray" variant="light">used</Badge>}
          </span>
        </Button>;
      })}
    </div>
  </section>;
}

export function HandScorecard({ board, selection, busy, onSelect }: {
  board: Board; selection: Selection; busy: boolean; onSelect: (hand: HandId) => void;
}) {
  const encounterDice = activeEncounterDice(board);
  const unavailableHands = unavailableEncounterHands(board);
  const requiredDieIds = requiredEncounterDieIds(board);
  const hasCompatibleHand = [...UPPER_HAND_IDS, ...LOWER_HAND_IDS].some(hand => !unavailableHands.includes(hand)
    && combinationsForHand(encounterDice, hand).some(set => selection.dieIds.every(id => set.includes(id))
      && requiredDieIds.every(id => set.includes(id))));
  return <div className="scorecard">
    <div className="scorecard-grid">
      <ScorecardSection title="Upper" hands={UPPER_HAND_IDS} {...{ board, selection, busy, onSelect }} />
      <ScorecardSection title="Lower" hands={LOWER_HAND_IDS} {...{ board, selection, busy, onSelect }} />
    </div>
    {selection.dieIds.length > 0 && !hasCompatibleHand && <Text size="xs" c="orange" className="scorecard-hint">
      {board.boss?.type === 'hexer' ? 'No available hand includes the Cursed Die.' : 'No available hand contains all selected dice.'}
    </Text>}
  </div>;
}
