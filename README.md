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
- `min(5, floor(heldGold / 5))` interest, using held Gold after scoring effects;
- an additional +5 Flame Bonus on rounds divisible by three.

Interest is snapshotted before the Flame Bonus is awarded. The ordinary clear payout is at most 13 and an every-third-round payout is at most 18 before enhancement income. Shop dice rerolls cost 2/4/8/16… and enhancement rerolls cost 3/6/12/24…. Hand Training costs 4 Gold. Lifetime normal-shop spending includes enhancements, training, and both shop reroll types.

Enhancements attach to an exposed physical face. A face holds at most three distinct enhancement types; more stacks of an existing type use no additional type slot. Sticky, Hitchhiker, Golden, and Jackpot cap at three stacks. With no offer selected, selecting an exposed die opens Manage Die with all six faces and their capacities. Any enhancement type can be scrapped there, removing all its stacks with no refund. A fourth-type attempt opens the same modal focused on the full face and preserves the pending offer so it can be applied after room is made.

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

Every third clear opens the special Flame Reward screen before the shop. New Flames remain exclusive to this cadence. The rolled faces carry into the shop without another free roll. On the reward screen the player may:

- Stoke arbitrary whole Gold amounts into active Flames by selecting their physical dice;
- acquire at most one offered Flame;
- replace an active Flame and lose its investment;
- reroll offers for 5/10/20/40… Gold;
- skip acquisition and continue.

New Flames are 0-Gold Embers with neutral effects. Owned Flames can be Stoked through their physical die on every normal shop as well as on Flame Rewards; normal shops never acquire or replace Flames. Investment is limited to 100. At 100 the Flame becomes a Bonfire: it detaches from its die, frees the slot, appears in the global Bonfire strip, and applies once globally. Active and Bonfire types are unique and are excluded from future offers.

Let `p = investedGold / 100`, clamped to `[0, 1]`. Every XMult Flame returns a factor and scoring applies `XMult *= factor`. Multiple factors multiply; no Flame adds a bonus directly to global XMult.

The final roster is:

| Flame | Active rule | Bonfire rule |
|---|---|---|
| Ultimate | Highest-level hand: factor `1 + 4p` (×1→×5) | Every qualifying hand gets ×5 |
| Minigun | Upper hand: factor `1 + 4p` (×1→×5) | Every Upper hand gets ×5 |
| Hail Mary | Zero rerolls: factor `1 + 4p` (×1→×5) | Every qualifying hand gets ×5 |
| Charge | Each gameplay roll grows the stored factor by `p`; armed Charge contributes that factor | Every gameplay die roll grows it by 1 |
| Personal Trainer | `min(75%, 150% × p)` training chance; no XMult factor | One 75% check per hand |
| Dragon's Hoard | `1 + 4p × min(heldGold/100, 1)`, capped at ×5 | Global full-progress formula |
| Well Trained | `min(5, 1 + previousPlays × 0.2p)` | Global full-progress formula |
| Target Practice | Targeted Lower hand: factor `1 + 8p` (×1→×9) | Targeted hand gets ×9 globally |
| Hot Streak | Factor `1 + successfulCharges × p` on the current sequence hand | Removes the die requirement; full coefficient |
| Money to Burn | `1 + 4p × min(shopSpend/100, 1)`, capped at ×5 | Global full-progress formula |
| Lowball | `1 + 2 × (printedFaceTier − 1) × p`, up to ×5 | Global full-progress printed-face factor |
| Straight Shooter | Small/Large Straight: factor `1 + 4p` (×1→×5) | Those Straights get ×5 globally |
| Double Down | Pair/Two Pair: factor `1 + 4p` (×1→×5) | Pair and Two Pair get ×5 globally |

Charge must be armed explicitly. It resets after use and at round start. Post-hand gameplay rerolls can immediately begin charging the next hand.

Hot Streak resets to Pair and zero charges each round. Its sequence is Pair → Two Pair → Three of a Kind → Small Straight → Full House → Four of a Kind → Large Straight → Five of a Kind. Playing a future sequence hand early does not reset the current goal; when reached later, that already-consumed hand is skipped without retroactive charge.

Target Practice chooses from the three least-played Lower hands using seeded RNG and remains fixed for the round. Lowball uses printed/current face values, including successful Hitchhikers, never Bonus or Workout pips.

## Telemetry and validation

Run Info exports schema 12 / `multiplicative-flames-v2`, including source-aware hand scores, ordered XMult factor records, Flame Reward/shop Stoke sources, Flame progression, Charge, Trainer, Hot Streak, shop spending, and clear-payout components.

Validation commands:

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
git diff --check
```
