import { describe, expect, it } from 'vitest';
import { BOSSES } from './bosses';
import { ENHANCEMENTS } from './enhancements';
import { FLAMES, HOT_STREAK_SEQUENCE, hotStreakMultiplier } from './flames';

describe('canonical player-facing definitions', () => {
  it('keeps Enhancement descriptions centralized and exact', () => {
    expect(Object.fromEntries(Object.entries(ENHANCEMENTS).map(([id, item]) => [id, item.description]))).toEqual({
      bonus: '+10 Pips when this face scores. Stack for more Pips.',
      jumpingBean: 'When rolled, plays the matching Upper hand for free, then rerolls.',
      golden: 'Gain +1 Gold when this face scores. Stack up to three for more Gold.',
      workout: 'After scoring, this face permanently gains +1 Pip. Stack for faster growth.',
      missingLink: 'Counts as any face in a Straight. Scores its own Pips.',
      mirror: 'Counts as any matching face in group hands. Scores its own Pips.',
      magnetic: 'Once per Round, held Magnets pull rolling dice toward other Magnets.',
      sticky: 'May keep this die from rerolling after it scores. Stack up to three to increase the odds.',
      slippy: 'Rerolls after you play a hand, even if this die did not score.',
      hitchhiker: 'When left out of a hand, it may jump in and score anyway. Stack up to three to increase the odds.',
      weighted: 'Makes the opposite face more likely to roll. Stack to increase the odds.',
      jackpot: 'Gain +3 Gold if this face scores in the hand that clears the Round. Stack up to three for more Gold.',
      personalTrainer: 'When this face scores, it may train the hand. Stack up to three to increase the odds.',
      bump: 'While showing, this die’s next roll moves up one face.',
      vintage: 'Each time this face scores, its sell value increases by 3 Gold.',
    });
  });

  it('keeps Flame descriptions centralized and exact', () => {
    expect(Object.fromEntries(Object.entries(FLAMES).map(([id, item]) => [id, item.description]))).toEqual({
      ultimate: 'Your highest level hand gains up to ×5 XMult.',
      minigun: 'Ones–Sixes gain up to ×5 XMult.',
      hailMary: 'Hands played with no Rerolls left gain up to ×5 XMult.',
      fullOfGrace: 'Last Play gains up to ×5 XMult.',
      charge: 'Scoring dice build Charge. Arm it for up to ×5 XMult.',
      dragonsHoard: 'Holding more Gold earns up to ×5 XMult.',
      wellTrained: 'Hands you play often gain up to ×5 XMult.',
      targetPractice: 'Hit your Target for up to ×9 XMult.',
      hotStreak: 'Chain Lower hands in order to build XMult, up to ×9.',
      moneyToBurn: 'Spending Gold in Shops earns up to ×5 XMult.',
      lowball: 'Low face values earn up to ×5 XMult.',
      straightShooter: 'Small Straight and Large Straight gain up to ×5 XMult.',
      doubleDown: 'Pair and Two Pair gain up to ×5 XMult.',
      threesCompany: 'Three of a Kind and Full House gain up to ×5 XMult.',
      boxSet: 'Four of a Kind and Five of a Kind gain up to ×5 XMult.',
    });
    expect(hotStreakMultiplier(100, HOT_STREAK_SEQUENCE.length)).toBe(9);
  });

  it('keeps boss descriptions centralized and exact', () => {
    expect(Object.fromEntries(Object.entries(BOSSES).map(([id, item]) => [id, item.shortRule]))).toEqual({
      caller: 'Play the called hand before it comes due or lose half your total score.',
      warden: 'Choose one die to start. Score enough to unlock the rest.',
      hexer: 'A Cursed Die joins you and must be used in every hand.',
      marathon: 'Extra large Goal. Played hands return after 7 other hands are played.',
      quickdraw: 'Reduced Goal, but you can only play a single Lower hand.',
      fly: 'Your played hands are weakened until you catch The Fly on the marked Lower hand.',
      snakeEyes: 'Scored faces turn into 1s.',
      infected: 'Infected faces lose 3 Pips and their Enhancements. Played faces become infected.',
    });
  });
});
