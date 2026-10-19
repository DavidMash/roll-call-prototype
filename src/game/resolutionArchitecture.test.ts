import { describe, expect, it } from 'vitest';
import { createPlayIntent, createRollBatchIntent, createRollIntent } from './resolution';

describe('resolution architecture boundaries', () => {
  it('retains committed, player-selected, and generated Play identities separately', () => {
    expect(createPlayIntent('play:1', 'threeKind', [2, 0, 1], 'manual', 125)).toMatchObject({
      id: 'play:1', hand: 'threeKind', source: 'manual', cause: 'player',
      selectedDieIds: [2, 0, 1], originalSelectedDieIds: [2, 0, 1], playerSelectedDieIds: [2, 0, 1],
    });
    expect(createPlayIntent('play:2', 'sixes', [4], 'jumpingBean', null)).toMatchObject({
      cause: 'jumping_bean', selectedDieIds: [4], originalSelectedDieIds: [4], playerSelectedDieIds: [],
    });
  });

  it('classifies initial, manual, post-Play, and generated Roll intents', () => {
    expect(createRollBatchIntent('roll:1', [0, 1], 'Initial round roll', 'gameplay', 'initial_round'))
      .toMatchObject({ initialRoundRoll: true, reroll: false, manual: false });
    const manual = createRollBatchIntent('roll:2', [0], 'Manual gameplay reroll', 'gameplay', 'manual');
    expect(createRollIntent(manual, 0)).toMatchObject({ dieId: 0, reroll: true, manual: true, excludeStartingFace: true });
    expect(createRollBatchIntent('roll:3', [0], 'Post-hand reroll', 'gameplay', 'post_hand')).toMatchObject({ postPlay: true });
    expect(createRollBatchIntent('roll:4', [0], 'Jumping Bean reroll', 'gameplay', 'jumping_bean_followup'))
      .toMatchObject({ effectGenerated: true });
  });
});
