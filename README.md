# Roll Call prototype

Roll Call is a deterministic React/TypeScript/Vite dice roguelike. The domain engine resolves complete actions synchronously and emits immutable events and board snapshots; React only plays those snapshots. Playback speed therefore cannot affect outcomes.

## Core loop

Choose a legal Yahtzee-style hand, select its physical dice, and play it. A played category is consumed for the round. Each round grants three manual die rerolls, charged once per selected die. Reach the target to enter the shop; a run ends only when the score is below target, no unconsumed hand is playable, and no manual rerolls remain.

Scoring is:

```text
round(Pips × Mult × XMult)
```

Every XMult contribution is a multiplicative factor and the factors are composed centrally. There is no additive-XMult state. Large builds can still compound to enormous scores, but each Flame has a hand, resource, or sequencing condition.

## Gold and shops

Every clear pays:

- 5 base Gold;
- 1 Gold per unused manual reroll (0–3);
- `min(5, floor(heldGold / 5))` interest, using held Gold after scoring effects.

The clear payout is at most 13 before enhancement income. Shop dice rerolls cost 2/4/8/16… and enhancement rerolls cost 3/6/12/24…. Hand Training costs 4 Gold. Lifetime normal-shop spending includes enhancements, training, and both shop reroll types.

Enhancements attach to an exposed physical face. A face holds at most three distinct enhancement types; more stacks of an existing type use no additional type slot. Sticky, Hitchhiker, Golden, and Jackpot cap at three stacks. Any enhancement type can be scrapped from any face during a shop, removing all its stacks with no refund.

The enhancement roster is Bonus, Jumping Bean, Golden, Workout, Missing Link, Mirror, Magnetic, Sticky, Slippy, Hitchhiker, Weighted, Jackpot, and Bump. Sustainable and Multiplier have been removed. Ordinary Mult comes exclusively from each hand’s trained Base Mult. Bump costs 2 Gold.

Jumping Bean is a real free Upper-hand play rather than an independent score. Rolling one free-plays the matching Ones–Sixes category using only that die and its trained Base Pips/Base Mult, records the score in that category, increments hand history, and then rerolls the die. It works even if the category is already consumed and never consumes or reopens its normal use. Relevant face effects and hand-based Flames apply; Hitchhiker, generic Slippy/post-hand batches, Lower-only Flames, and automatic Charge consumption do not. Sticky may block the follow-up roll, Bump may control it, and another Bean landing can chain.

Golden pays +1 Gold per stack whenever its scoring face participates, up to +3. Jackpot pays +3 Gold per stack only when its face scores in the hand that clears the round, up to +9 per face.

### Roll control

Roll-result precedence is:

1. Bump, if the die begins the roll showing a Bump face;
2. attraction from a held Magnetic anchor;
3. Weighted/random selection.

Bump advances one numerical face, wrapping 6→1, on the next actual roll. Its destination can trigger normal landed-face effects, but Bump does not recurse in the same roll.

A Magnetic anchor must already be showing Magnetic before a roll batch and must be held outside that batch. It attracts each rolled die that owns a Magnetic face. Newly landed Magnetic faces never become anchors within the same batch.

## Flames, embers, and Bonfires

Every third clear opens one unified Flame Reward screen before the shop. The rolled faces carry into the shop without another free roll. The player may:

- invest arbitrary whole Gold amounts into active Flames;
- acquire at most one offered Flame;
- replace an active Flame and lose its investment;
- reroll offers for 5/10/20/40… Gold;
- skip acquisition and continue.

New Flames are 0-Gold embers with neutral effects. Investment is limited to 100 and can occur only on Flame Reward screens. At 100 the Flame becomes a Bonfire: it detaches from its die, frees the slot, and applies once globally. Active and Bonfire types are unique and are excluded from future offers.

The final roster is:

| Flame | Active rule | Bonfire rule |
|---|---|---|
| Ultimate | Scoring die in a highest-level hand; ×1→×3 | Every highest-level hand ×3 |
| Minigun | Scoring die in an Upper hand; ×1→×3 | Every Upper hand ×3 |
| Hail Mary | Scoring die with 0 rerolls left; ×1→×3 | Every such hand ×3 |
| Charge | Its gameplay rolls add `0.5 × progress` to stored Charge | Every gameplay die roll adds 0.5 |
| Personal Trainer | Scoring die gives `75% × progress` chance to train after scoring | One 75% check per hand |
| Dragon's Hoard | `1 + 2 × progress × min(heldGold/100, 1)` | Global full-progress formula |
| Well Trained | `min(3, 1 + previousPlays × 0.1 × progress)` | Global full-progress formula |
| Target Practice | Targeted Lower hand ×1→×5 | Targeted hand ×5 globally |
| Hot Streak | In-order Lower sequence, +`0.5 × progress` per successful charge | Removes the die requirement |
| Money to Burn | `1 + 2 × progress × min(shopSpend/100, 1)` | Global full-progress formula |
| Lowball | Printed-face average tier, interpolated toward ×1 | Global printed-face tier |
| Straight Shooter | Small/Large Straight ×1→×3 | Those Straights ×3 globally |
| Double Down | Pair/Two Pair ×1→×3 | Pair/Two Pair ×3 globally |

Charge must be armed explicitly. It resets after use and at round start. Post-hand gameplay rerolls can immediately begin charging the next hand.

Hot Streak resets to Pair and zero charges each round. Its sequence is Pair → Two Pair → Three of a Kind → Small Straight → Full House → Four of a Kind → Large Straight → Five of a Kind. Playing a future sequence hand early does not reset the current goal; when reached later, that already-consumed hand is skipped without retroactive charge.

Target Practice chooses from the three least-played Lower hands using seeded RNG and remains fixed for the round. Lowball uses printed/current face values, including successful Hitchhikers, never Bonus or Workout pips.

## Telemetry and validation

Run Info exports schema 10 / `free-upper-jumping-bean-v1`, including source-aware hand scores, Jumping Bean free-play records, XMult factors, Flame progression, Charge, Trainer, Hot Streak, shop spending, Magnetic anchors, Bump rolls, scraps, and clear-payout components.

Validation commands:

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
git diff --check
```
