import { Badge, Button, Text, Tooltip } from '@mantine/core';
import { combinationsForHand, handStats, HANDS, LOWER_HAND_IDS, ultimateHands, UPPER_HAND_IDS } from '../game/hands';
import { activeFlameId } from '../game/flames';
import type { Selection } from '../game/selection';
import type { Board, HandId } from '../game/types';
import { activeEncounterDice, requiredEncounterDieIds, unavailableEncounterHands } from '../game/bosses';
import { EMPTY_TEXT, formatScoreEquation } from '../game/copy';

const MOBILE_HAND_NAMES: Partial<Record<HandId, string>> = {
  twoPair: 'Two Pair',
  threeKind: '3 of a Kind',
  smallStraight: 'Sm Straight',
  fullHouse: 'Full House',
  fourKind: '4 of a Kind',
  largeStraight: 'Lg Straight',
  fiveKind: '5 of a Kind',
};

export interface HandSubmitPreview {
  pips: number;
  multiplier: number;
  hasXMult: boolean;
  effectiveXMult: number;
  score: number;
}

function SendIcon() {
  return <svg className="quick-submit-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3.4 3.2 21 12 3.4 20.8l2.1-7.1 8.2-1.7-8.2-1.7-2.1-7.1Z" />
  </svg>;
}

function ScorecardSection({ title, hands, board, selection, busy, canSubmit, submitPreview, onSelect, onSubmit }: {
  title: string; hands: HandId[]; board: Board; selection: Selection; busy: boolean; canSubmit: boolean; submitPreview: HandSubmitPreview | null;
  onSelect: (hand: HandId) => void; onSubmit: () => void;
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
        const scoreLabel = score === undefined ? EMPTY_TEXT.score : `${score} points`;
        const showQuickPlay = selected && canSubmit;
        return <div key={hand} className={`scorecard-row-shell ${showQuickPlay ? 'has-quick-play' : ''}`}>
        <Button variant={selected ? 'light' : 'subtle'} color={selected ? 'teal' : 'gray'}
          className={`scorecard-row ${state} ${targeted ? 'targeted' : ''} ${board.boss?.type === 'caller' && board.boss.calledHand === hand ? 'caller-called' : ''} ${board.boss?.type === 'fly' && board.boss.flyHand === hand ? 'fly-row' : ''}`} data-testid={`scorecard-row-${hand}`} data-state={state}
          disabled={busy || !playable} onClick={() => onSelect(hand)} aria-pressed={selected}
          aria-keyshortcuts={selected && canSubmit ? 'Enter' : undefined}
          aria-label={`${definition.name} · Lv. ${stats.level} · ${stats.basePips} Pips · ×${stats.baseMultiplier} Mult${isUltimate ? ' · Ultimate Hand' : ''} · ${scoreLabel}${consumed ? ' · Used' : ''}`}>
          <span className="scorecard-row-copy">
            <span className="scorecard-hand-name" title={definition.name}>
              <span className="scorecard-name-line">
                {targeted && <span className="target-marker" title="Target Practice target"><span className="wide-label">◎ TARGET </span><span className="compact-label">◎ </span></span>}
                {hotTarget && <span className="target-marker" title="Hot Streak goal"><span className="wide-label">🔥 NEXT </span><span className="compact-label">🔥 </span></span>}
                {board.boss?.type === 'fly' && board.boss.flyHand === hand && <span className="fly-marker" title="The Fly is here"><span className="wide-label">● FLY </span><span className="compact-label">● </span></span>}
                <span className="hand-name-full">{definition.name}</span><span className="hand-name-compact">{MOBILE_HAND_NAMES[hand] ?? definition.name}</span>
              </span>
              <span className="hand-level">Lv. {stats.level}</span>
            </span>
            {isUltimate && <Tooltip label="Your highest level hand." multiline maw={300} withArrow>
              <Badge className="ultimate-badge" size="xs" color="grape" variant="light" data-testid={`ultimate-badge-${hand}`}><span className="wide-label">ULTIMATE</span><span className="compact-label">U</span></Badge>
            </Tooltip>}
          </span>
          <span className="scorecard-row-result">
            <span data-testid={`scorecard-score-${hand}`}>{score ?? '—'}</span>
            {cooldown > 0 ? <Badge className="scorecard-state-badge" size="xs" color="orange" variant="light" title={`Cooldown ${cooldown}`}><span className="wide-label">COOLDOWN </span><span className="compact-label">CD </span>{cooldown}</Badge>
              : quickdrawLocked ? <Badge size="xs" color="yellow" variant="light">LOCKED</Badge>
              : consumed && <Badge size="xs" color="gray" variant="light">USED</Badge>}
          </span>
        </Button>
        {showQuickPlay && submitPreview && <Button className="scorecard-quick-play" size="compact-xs"
          aria-label={`Play ${definition.name} for ${submitPreview.score} points`} onClick={onSubmit}>
          <span className="quick-score-expression">
            {formatScoreEquation(submitPreview.pips, submitPreview.multiplier, submitPreview.effectiveXMult, submitPreview.score)}
          </span>
          <SendIcon />
        </Button>}
        </div>;
      })}
    </div>
  </section>;
}

export function HandScorecard({ board, selection, busy, canSubmit, submitPreview, onSelect, onSubmit }: {
  board: Board; selection: Selection; busy: boolean; canSubmit: boolean; submitPreview: HandSubmitPreview | null;
  onSelect: (hand: HandId) => void; onSubmit: () => void;
}) {
  const encounterDice = activeEncounterDice(board);
  const unavailableHands = unavailableEncounterHands(board);
  const requiredDieIds = requiredEncounterDieIds(board);
  const hasCompatibleHand = [...UPPER_HAND_IDS, ...LOWER_HAND_IDS].some(hand => !unavailableHands.includes(hand)
    && combinationsForHand(encounterDice, hand).some(set => selection.dieIds.every(id => set.includes(id))
      && requiredDieIds.every(id => set.includes(id))));
  return <div className="scorecard">
    <div className="scorecard-grid">
      <ScorecardSection title="Upper" hands={UPPER_HAND_IDS} {...{ board, selection, busy, canSubmit, submitPreview, onSelect, onSubmit }} />
      <ScorecardSection title="Lower" hands={LOWER_HAND_IDS} {...{ board, selection, busy, canSubmit, submitPreview, onSelect, onSubmit }} />
    </div>
    {selection.dieIds.length > 0 && !hasCompatibleHand && <Text size="xs" c="orange" className="scorecard-hint">
      {board.boss?.type === 'hexer' ? 'No available hand includes the Cursed Die.' : 'No available hand contains all selected dice.'}
    </Text>}
  </div>;
}
