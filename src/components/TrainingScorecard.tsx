import { Badge, Button, Group, Text } from '@mantine/core';
import { handStats, HANDS, LOWER_HAND_IDS, relativeHandStrengthTiers, UPPER_HAND_IDS } from '../game/hands';
import { createTrainingSession, quoteTraining } from '../game/training';
import type { HandId, HandLevels, Shop } from '../game/types';
import { formatPlayerNumber } from '../game/copy';
import { CurrencyAmount } from './CurrencyAmount';

const COMPACT_HAND_NAMES: Partial<Record<HandId, string>> = {
  threeKind: '3 of a Kind', smallStraight: 'Sm Straight', fourKind: '4 of a Kind',
  largeStraight: 'Lg Straight', fiveKind: '5 of a Kind',
};

function TrainingSection({ title, hands, levels, shop, gold, busy, onTrain }: {
  title: 'Upper' | 'Lower'; hands: HandId[]; levels: HandLevels; shop: Shop; gold: number; busy: boolean;
  onTrain: (hand: HandId) => void;
}) {
  const session = shop.trainingSession ?? createTrainingSession(levels);
  const baseline = title === 'Upper' ? session.upperBaseline : session.lowerBaseline;
  const strengthTiers = relativeHandStrengthTiers(levels, hands);
  return <section className="scorecard-section training-scorecard-section" aria-labelledby={`training-${title.toLowerCase()}`}>
    <Group justify="space-between" gap="xs" className="training-section-heading">
      <Text id={`training-${title.toLowerCase()}`} className="scorecard-section-title" size="xs" fw={700} tt="uppercase">{title}</Text>
      <Text size="xs" c="dimmed">Baseline · Lv. {formatPlayerNumber(baseline)}</Text>
    </Group>
    <div className="scorecard-rows">
      {hands.map(hand => {
        const stats = handStats(hand, levels[hand]);
        const quote = quoteTraining(session, levels, hand);
        const unaffordable = quote.actualPrice === null || gold < quote.actualPrice;
        const strength = strengthTiers[hand] ?? 'normal';
        const priceLabel = quote.actualPrice === null ? 'UNAFFORDABLE'
          : quote.waivedByOnTheHouse ? `FREE · ${formatPlayerNumber(quote.normalPrice!)} GOLD VALUE`
          : `${formatPlayerNumber(quote.actualPrice)} GOLD`;
        const compactPrice = quote.actualPrice === null ? '—' : quote.waivedByOnTheHouse
          ? 'FREE' : <CurrencyAmount currency="gold" value={quote.actualPrice} />;
        return <div key={hand} className="training-scorecard-row" data-testid={`training-offer-${hand}`}
          data-tutorial={`training-${hand}`} data-strength-tier={strength}>
          <div className={`training-hand-summary strength-${strength}`}>
            <span className="scorecard-hand-name"><span className="hand-name-full">{HANDS[hand].name}</span>
              <span className="hand-name-compact">{COMPACT_HAND_NAMES[hand] ?? HANDS[hand].name}</span>
              <span className="hand-level" data-testid={`training-stats-${hand}`}>
                <span className="hand-level-value">Lv. {formatPlayerNumber(stats.level)}</span>
                <span className="hand-stat"><strong>{formatPlayerNumber(stats.basePips)}</strong><small>PIPS</small></span>
                <span className="hand-stat-times" aria-hidden="true">×</span>
                <span className="hand-stat"><strong>{formatPlayerNumber(stats.baseMultiplier)}</strong><small>MULT</small></span>
              </span></span>
            {quote.purchaseCount > 0 && <Badge size="xs" color="teal" variant="light">TRAINED ×{quote.purchaseCount}</Badge>}
          </div>
          <Button className="training-action" size="compact-xs" color="violet" variant="light"
            disabled={busy || unaffordable} onClick={() => onTrain(hand)} data-testid={`train-${hand}`}
            aria-label={`Train ${HANDS[hand].name} for ${priceLabel}`}>
            {compactPrice}
          </Button>
        </div>;
      })}
    </div>
  </section>;
}

export function TrainingScorecard({ handLevels, shop, gold, busy, onTrain }: {
  handLevels: HandLevels; shop: Shop; gold: number; busy: boolean; onTrain: (hand: HandId) => void;
}) {
  return <div className="scorecard training-scorecard" data-testid="training-scorecard">
    <div className="scorecard-grid">
      <TrainingSection title="Upper" hands={UPPER_HAND_IDS} levels={handLevels} {...{ shop, gold, busy, onTrain }} />
      <TrainingSection title="Lower" hands={LOWER_HAND_IDS} levels={handLevels} {...{ shop, gold, busy, onTrain }} />
    </div>
  </div>;
}
