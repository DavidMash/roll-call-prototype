# Roll Call prototype

Roll Call is a deterministic React/TypeScript/Vite dice roguelike. The domain engine resolves actions synchronously and emits immutable events and board snapshots; React only plays those snapshots. Playback speed cannot change outcomes.

## Rounds, lives, and Busts

Choose a legal Yahtzee-style hand, select its physical dice, and play it. A played category is consumed for the round. Each attempt grants three manual die rerolls, charged once per selected die.

A run starts with `3 / 3` lives. When score is below target, no legal unconsumed hand remains, and no manual rerolls remain, the attempt Busts. The engine restores its round-start checkpoint, subtracts one life, increments the attempt number, and retries the same round. Each attempt uses a deterministic seed derived from the run seed, round, and attempt, so retries are reproducible but do not repeat the same roll stream. A Bust that reduces lives to zero ends the run.

The checkpoint prevents failed-attempt farming. Score, consumed hands, dice, rerolls, gameplay Gold, Charge, Hot Streak, Workout, Personal Trainer levels, hand history, Vintage growth, and other attempt changes roll back. Shop purchases made before the attempt remain.

Scoring remains:

```text
round(Pips × Mult × XMult)
```

Every XMult contribution is a multiplicative factor composed centrally. Ordinary Mult still comes from trained hand Base Mult.

## Gold and the Shop

The normal Shop is the only place Gold is spent. It contains enhancement purchases and refreshes, Hand Training, paid dice rerolls, Flame Stoke controls, and life restoration. Gold may still be earned during scoring.

Every successful clear pays, in order:

- 5 base Gold;
- 1 Gold per unused manual reroll;
- `min(5, floor(heldGold / 5))` interest using the pre-payout Gold snapshot;
- +5 Flame Bonus on rounds divisible by three.

A failed attempt pays none of these rewards. The Flame Bonus does not affect the interest calculation that precedes it.

Lost lives can be restored one at a time only in a normal Shop. The run-wide prices are `25, 40, 60, 90, 130, 180, 240, 310, 390, 480…`; after 390, each new increment is 10 larger than the prior increment. Restoration spending counts toward Money to Burn. The price counter resets only on a new run, and lives cannot exceed three.

Lifetime normal-Shop spending includes enhancement purchases, Hand Training, both paid Shop rerolls, and life restoration. Flame Stoke does not count. Enhancement sales are income and do not reduce or increase historical spending.

## Enhancements and selling

Enhancements attach to the exposed physical face. A face holds at most three distinct types; extra stacks of an existing type use no additional slot. Clicking a die with no offer selected opens Manage Die for all six faces and its Ember. A fourth-type attempt opens Manage Die on the full face and preserves the pending offer, allowing a sale followed by immediate application.

Selling removes every stack of the selected enhancement type from that face. Normal stack sales pay `stack count × base sell price`. Sale prices and purchase prices are authoritative enhancement metadata.

| Enhancement | Buy | Base sell / stack |
|---|---:|---:|
| Sticky | 2 | 1 |
| Slippy | 2 | 1 |
| Jumping Bean | 2 | 1 |
| Golden | 2 | 1 |
| Missing Link | 2 | 1 |
| Mirror | 2 | 1 |
| Hitchhiker | 2 | 1 |
| Bump | 2 | 1 |
| Bonus | 3 | 1 |
| Workout | 3 | 2 |
| Magnetic | 3 | 2 |
| Weighted | 3 | 2 |
| Jackpot | 3 | 1 |
| Vintage | 3 | dynamic |

Sticky and Slippy now cost 2 Gold; their gameplay behavior is unchanged.

### Vintage

Vintage is unique and non-stackable. A new instance starts with a 0-Gold sell value and has no direct scoring effect. Whenever its physical face participates in a resolved scoring hand, its sell value increases by 3 Gold exactly once. Selected dice, successful Hitchhikers, and Jumping Bean free plays qualify; rolls, displayed faces, failed Hitchhikers, Shop rolls, and Flame Reward rolls do not. Separate Bean-chain hand resolutions may each grow it.

Vintage has no value cap and may exceed its 3-Gold purchase price. Selling pays its current value and deletes that accumulated state; repurchasing starts at 0. Failed-attempt growth rolls back with the round checkpoint.

## Flame Rewards, Embers, and Bonfires

Every third successful clear adds the +5 Flame Bonus and opens the special Flame Reward before the Shop. This screen only allows the player to select one of the three deterministic distinct offers and assign it to a physical die, or skip. There are no paid offer rerolls and no Stoke controls on Flame Rewards.

New Flames begin as 0-Gold Embers. The immediately following Shop shows a one-time controlled tooltip on the first Flame’s die, teaching the player to click the die, Stoke it, and reach Bonfire at 100 Gold. All Flame investment occurs through Manage Die in a normal Shop. Arbitrary positive whole-Gold Stoke amounts are supported and do not count toward Money to Burn spending.

At exactly 100 invested Gold an Ember becomes a global Bonfire, detaches from its die, and cannot be reacquired. Replacing an active Ember during a later Flame Reward destroys its investment. The threshold and all Flame formulas remain unchanged.

Let `p = investedGold / 100`, clamped to `[0, 1]`. Every XMult Flame returns a factor and scoring applies `XMult *= factor`.

| Flame | Active rule |
|---|---|
| Ultimate | Highest-level hand: `1 + 4p`, max ×5 |
| Minigun | Upper hand: `1 + 4p`, max ×5 |
| Hail Mary | Zero rerolls: `1 + 4p`, max ×5 |
| Charge | Gameplay rolls add `p` to its stored factor; armed factor multiplies XMult |
| Personal Trainer | `min(75%, 150% × p)` training chance; no XMult |
| Dragon's Hoard | `1 + 4p × min(heldGold/100, 1)`, max ×5 |
| Well Trained | `min(5, 1 + previousPlays × 0.2p)` |
| Target Practice | Targeted Lower hand: `1 + 8p`, max ×9 |
| Hot Streak | `1 + successfulCharges × p` |
| Money to Burn | `1 + 4p × min(shopSpend/100, 1)`, max ×5 |
| Lowball | `1 + 2 × (printedFaceTier − 1) × p`, max ×5 |
| Straight Shooter | Small/Large Straight: `1 + 4p`, max ×5 |
| Double Down | Pair/Two Pair: `1 + 4p`, max ×5 |

## Telemetry and validation

Run Info exports schema 13 / `lives-vintage-economy-v1`, including round attempts, Bust/life transitions, restore purchases, enhancement sales, Vintage growth, source-aware hand scores, Flame factors, Stoke records, and Shop spending.

Validation commands:

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
git diff --check
```
