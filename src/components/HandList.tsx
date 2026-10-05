import { Badge, Button, Text, Tooltip } from '@mantine/core';
import { handStats, HANDS, HAND_IDS, LOWER_HAND_IDS, ultimateHands, UPPER_HAND_IDS } from '../game/hands';
import { activeFlameId, handFamilyFlameTargets } from '../game/flames';
import type { Selection } from '../game/selection';
import type { Board, HandId } from '../game/types';
import { EMPTY_TEXT, formatPlayerNumber, formatScoreEquation } from '../game/copy';
import { boardHandAvailable, legalHandCombinations } from '../game/selection';

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
  const ultimate = new Set(ultimateHands(board.handLevels));
  const ownsUltimate = board.bonfires.includes('ultimate')
    || board.dice.some(die => activeFlameId(die.flame) === 'ultimate');
  const flameTargets = new Set(handFamilyFlameTargets(board));
  return <section className="scorecard-section" aria-labelledby={`scorecard-${title.toLowerCase()}`}>
    <Text id={`scorecard-${title.toLowerCase()}`} className="scorecard-section-title" size="xs" fw={700} tt="uppercase">{title}</Text>
    <div className="scorecard-rows">
      {hands.map(hand => {
        const definition = HANDS[hand];
        const stats = handStats(hand, board.handLevels[hand]);
        const used = board.consumed.includes(hand);
        const cooldown = !board.bossSilenced && board.boss?.type === 'marathon' ? board.boss.cooldowns[hand] ?? 0 : 0;
        const neglected = !board.bossSilenced && board.boss?.type === 'neglected' && board.boss.neglectedHands.includes(hand);
        const quickdrawLocked = !board.bossSilenced && board.boss?.type === 'quickdraw' && board.boss.lowerShotUsed && LOWER_HAND_IDS.includes(hand);
        const playable = boardHandAvailable(board, hand);
        const selected = selection.hand === hand;
        const targeted = board.targetPracticeHand === hand || flameTargets.has(hand);
        const hotTarget = board.hotStreakGoal === hand;
        const isUltimate = ownsUltimate && ultimate.has(hand);
        const score = board.scoreByHand[hand];
        const state = used ? 'consumed' : selected ? 'selected' : playable ? 'playable' : 'unavailable';
        const scoreLabel = score === undefined ? EMPTY_TEXT.score : `${formatPlayerNumber(score)} points`;
        const showQuickPlay = selected && canSubmit;
        return <div key={hand} className={`scorecard-row-shell ${showQuickPlay ? 'has-quick-play' : ''}`} data-tutorial={`hand-${hand}`}>
        <Button variant={selected ? 'light' : 'subtle'} color={selected ? 'teal' : 'gray'}
          className={`scorecard-row ${state} ${targeted ? 'targeted' : ''} ${board.boss?.type === 'caller' && board.boss.calledHand === hand ? 'caller-called' : ''} ${board.boss?.type === 'fly' && board.boss.flyHand === hand ? 'fly-row' : ''}`} data-testid={`scorecard-row-${hand}`} data-state={state}
          disabled={busy || !playable} onClick={() => onSelect(hand)} aria-pressed={selected}
          aria-keyshortcuts={selected && canSubmit ? 'Enter' : undefined}
          aria-label={`${definition.name} · Lv. ${formatPlayerNumber(stats.level)} · ${formatPlayerNumber(stats.basePips)} Pips · ×${formatPlayerNumber(stats.baseMultiplier)} Mult${isUltimate ? ' · Ultimate Hand' : ''} · ${scoreLabel}${used ? ' · Used' : ''}${neglected ? ' · Neglected' : ''}`}>
          <span className="scorecard-row-copy">
            <span className="scorecard-hand-name" title={definition.name}>
              <span className="scorecard-name-line">
                {targeted && <span className="target-marker" title={board.targetPracticeHand === hand ? 'Target Practice target' : 'Flame target'}><span className="wide-label">◎ TARGET </span><span className="compact-label">◎ </span></span>}
                {hotTarget && <span className="target-marker" title="Hot Streak goal"><span className="wide-label">🔥 NEXT </span><span className="compact-label">🔥 </span></span>}
                {board.boss?.type === 'fly' && board.boss.flyHand === hand && <span className="fly-marker" title="The Fly is here"><span className="wide-label">● FLY </span><span className="compact-label">● </span></span>}
                <span className="hand-name-full">{definition.name}</span><span className="hand-name-compact">{MOBILE_HAND_NAMES[hand] ?? definition.name}</span>
              </span>
              <span className="hand-level">Lv. {formatPlayerNumber(stats.level)}</span>
            </span>
            {isUltimate && <Tooltip label="Your highest level hand." multiline maw={300} withArrow>
              <Badge className="ultimate-badge" size="xs" color="grape" variant="light" data-testid={`ultimate-badge-${hand}`}><span className="wide-label">ULTIMATE</span><span className="compact-label">U</span></Badge>
            </Tooltip>}
          </span>
          <span className="scorecard-row-result">
            <span data-testid={`scorecard-score-${hand}`}>{score === undefined ? '—' : formatPlayerNumber(score)}</span>
            {cooldown > 0 ? <Badge className="scorecard-state-badge" size="xs" color="orange" variant="light" title={`Cooldown ${cooldown}`}><span className="wide-label">COOLDOWN </span><span className="compact-label">CD </span>{cooldown}</Badge>
              : quickdrawLocked ? <Badge size="xs" color="yellow" variant="light">LOCKED</Badge>
              : neglected ? <Badge size="xs" color="gray" variant="light">NEGLECTED</Badge>
              : used && <Badge size="xs" color="gray" variant="light">USED</Badge>}
          </span>
        </Button>
        {showQuickPlay && submitPreview && <Button className="scorecard-quick-play" size="compact-xs"
          aria-label={`Play ${definition.name} for ${formatPlayerNumber(submitPreview.score)} points`} onClick={onSubmit}>
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
  const hasExactHand = HAND_IDS.some(hand => legalHandCombinations(board, hand)
    .some(combination => combination.length === selection.dieIds.length
      && combination.every(id => selection.dieIds.includes(id))));
  return <div className="scorecard" data-tutorial="scorecard">
    <div className="scorecard-grid">
      <ScorecardSection title="Upper" hands={UPPER_HAND_IDS} {...{ board, selection, busy, canSubmit, submitPreview, onSelect, onSubmit }} />
      <ScorecardSection title="Lower" hands={LOWER_HAND_IDS} {...{ board, selection, busy, canSubmit, submitPreview, onSelect, onSubmit }} />
    </div>
    {selection.intent === 'manual' && selection.dieIds.length > 0 && !hasExactHand && <Text size="xs" c="orange" className="scorecard-hint">
      {board.boss?.type === 'hexer' ? 'This selection does not form a hand with the Cursed Die.' : 'Selected dice do not form one complete available hand.'}
    </Text>}
  </div>;
}
