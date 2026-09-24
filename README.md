# Roll Call prototype

Roll Call is a deterministic React/TypeScript/Vite dice roguelike. The domain engine resolves actions synchronously and emits immutable events and board snapshots; React only plays those snapshots. Playback speed cannot change outcomes.

The browser keeps one active run in local storage. Refreshing the page or returning without a `seed` query resumes the latest settled game state; an interrupted event playback or map transition is skipped. A matching `?seed=` resumes that save, while a different explicit seed starts a fresh run and replaces it. Starting, restarting, or generating a run also replaces the saved run. Playback speed, selections, dialogs, and other transient UI state are not saved.

## Rounds, lives, and Busts

Choose a legal Yahtzee-style hand, select its physical dice, and play it. A played category is consumed for the round. Each attempt grants three manual die rerolls, charged once per selected die. A manual gameplay reroll always changes that die's printed face: the engine removes the current face from the normal seeded weighted distribution and samples once. Automatic, effect-driven, Boss-entry, and Shop rolls may still repeat naturally; Bump keeps its deterministic precedence.

A run starts with `3 / 3` lives. When score is below target, no legal unconsumed hand remains, and no manual rerolls remain, the attempt Busts. The engine restores the checkpoint captured when the player committed to the attempt, subtracts one life, increments the attempt number, and reopens that exact Shop. The failed round does not restart automatically: the player may continue preparing, then explicitly choose `RETRY ROUND N`. Each attempt uses a deterministic seed derived from the run seed, round, and attempt, so retries are reproducible but do not repeat the same roll stream. A Bust that reduces lives to zero ends the run without reopening the Shop.

The checkpoint prevents failed-attempt farming. Score, consumed hands, dice, rerolls, gameplay Gold, Charge, Hot Streak, Workout, Personal Trainer levels, hand history, Vintage growth, and other attempt changes roll back. The Shop's offers, purchased cards, reroll progression, exposed faces, Gold, enhancements, Flames, and training return exactly as committed; it does not refresh or grant another reward. Shop changes made after a Bust become the checkpoint for the next retry, so earlier purchases stay committed and new purchases, sales, Stoke, and life restoration persist into that attempt.

Scoring remains:

```text
round(Pips × Mult × XMult)
```

Every XMult contribution is a multiplicative factor composed centrally. Ordinary Mult still comes from trained hand Base Mult.

## Run map and Boss cadence

Progression follows one linear route: `Round 1 → Shop → Round 2 → Shop → Boss Round 3 → Flame Selection → Shop`, then repeats. A local map transition appears before every normal Round, Boss, Shop, and Flame Selection. It only shows nearby nodes, uses stable node IDs such as `round:2`, `boss:3`, `flame:after-round:3`, and `shop:before-round:4`, and waits for the player to continue. Reduced-motion preferences remove its animation without skipping the screen. Normal Rounds use blue (`#3B82F6`), Shops gold (`#F59E0B`), and Flame Selections red (`#EF4444`) over the shared dark foundation.

Every third round is a Boss encounter. Boss assignment is deterministic from the run seed and uses shuffled bags of Caller, Warden, and Hexer: all three occur before a reshuffle and the boundary cannot repeat the previous boss. The assignment is stored in run state, shown in the immediately preceding Shop, and remains stable on retry. Boss rounds use the normal round target and add a 10-Gold Boss Reward on a successful clear. Clearing one proceeds through Round Summary, the Flame Selection map transition, Flame Selection, and then the Shop transition.

### The Caller

The Caller (purple/magenta) chooses from Ones through Sixes, Pair, Two Pair, Three of a Kind, Small Straight, and Full House. The exact call is hidden in the Shop preview and revealed at encounter start. It must be completed within three manual plays. A matching Jumping Bean free play satisfies the call without decrementing the counter; a nonmatching Bean does not decrement it. The third nonmatching manual play Busts the attempt even if its score reached the target.

### The Warden

The Warden (cyan/teal) starts with D1 active and D2–D5 locked. Checkpoints at 10%, 25%, 45%, and 70% of the normal target, rounded to the game’s five-point target interval, automatically release D2, D3, D4, and D5 in that order, each with a real gameplay roll. Locked dice cannot be played, manually rerolled, trigger roll effects, or contribute attached Flames; global Bonfires remain active. A retry resets the encounter to D1.

### The Hexer

The Hexer (toxic green) adds a temporary boss-owned seven-sided Cursed Die that must participate in every manual hand and can otherwise roll and reroll normally. Its authored faces are:

| Face | Enhancements |
|---:|---|
| 1 | Golden 1, Jumping Bean, Weighted → 6 |
| 2 | Bonus 1, Jumping Bean, Weighted → 5 |
| 3 | Workout 1, Jumping Bean, Weighted → 4 |
| 4 | Missing Link, Mirror, Bump |
| 5 | Workout 5, Mirror, Bump |
| 6 | Workout 10, Mirror, Bump |
| 7 | Bonus 5, Jackpot 1, Sticky 1 |

Bump advances `4 → 5 → 6 → 7` and does not wrap. Seven is a genuine rank, so Small Straight recognizes `4-5-6-7` and Large Straight recognizes `3-4-5-6-7`. The Cursed Die cannot own Flames and is removed after a clear or failed-attempt rollback.

## Gold and the Shop

The normal Shop is the only place Gold is spent. It contains enhancement purchases and refreshes, Hand Training, paid dice rerolls, Flame Stoke controls, and life restoration. Gold may still be earned during scoring.

Every successful clear pays, in order:

- 5 base Gold;
- 1 Gold per unused manual reroll;
- `min(10, floor(heldGold / 5))` interest using the pre-payout Gold snapshot;
- +10 Boss Reward after successfully defeating a Boss.

A failed attempt pays none of these rewards. Interest is +1 per 5 Gold held, reaches its +10 maximum at 50 Gold, and is snapshotted after scoring Gold effects but before base, reroll, interest, or Boss Reward payouts are added. Thus the maximum standard normal-round payout is 18 Gold and the maximum standard Boss payout is 28 Gold, excluding scoring Gold such as Golden and Jackpot.

Every successful encounter pauses on a concise Round Summary before the next map transition. Its domain-owned snapshot shows score/target, Gold before and after, total Gold earned, and reconciled aggregate rows for Base Reward, unused rerolls, interest, Golden, Jackpot, other gameplay Gold, and Boss Reward when applicable. Bust attempts never create a successful summary.

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

Vintage is unique and non-stackable. A new instance starts with a 0-Gold sell value and has no direct scoring effect. Whenever its physical face participates in a resolved scoring hand, its sell value increases by 3 Gold exactly once. Selected dice, successful Hitchhikers, and Jumping Bean free plays qualify; rolls, displayed faces, failed Hitchhikers, Shop rolls, and Flame Selection rolls do not. Separate Bean-chain hand resolutions may each grow it.

Vintage has no value cap and may exceed its 3-Gold purchase price. Selling pays its current value and deletes that accumulated state; repurchasing starts at 0. Failed-attempt growth rolls back with the round checkpoint.

## Flame Selections, Embers, and Bonfires

Every third successful clear adds the +10 Boss Reward, shows its Round Summary, and then opens the special Flame Selection before the Shop. This screen only allows the player to select one of the three deterministic distinct offers and assign it to a physical die, or skip. There are no paid offer rerolls and no Stoke controls on Flame Selections.

New Flames begin as 0-Gold Embers. The immediately following Shop shows a one-time controlled tooltip on the first Flame’s die, teaching the player to click the die, Stoke it, and reach Bonfire at 100 Gold. All Flame investment occurs through Manage Die in a normal Shop. Arbitrary positive whole-Gold Stoke amounts are supported and do not count toward Money to Burn spending.

At exactly 100 invested Gold an Ember becomes a global Bonfire, detaches from its die, and cannot be reacquired. Replacing an active Ember during a later Flame Selection destroys its investment. The threshold and all Flame formulas remain unchanged.

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

## Dice visuals and live scoring

Physical die faces use a shared scalable pip layout in gameplay, the Shop, Manage Die, Flame Selection, and Warden choices. Faces 1–6 use standard real-die arrangements; the Hexer's impossible 7 uses the six-pip arrangement plus a center pip. Numeric face and scoring labels remain available in details and accessibility text. During Round and Boss gameplay, the live Pips / Mult / XMult panel sticks immediately below the measured global HUD while the scorecard scrolls.

## Telemetry and validation

Run Info exports schema 16 / `round-summary-boss-reward-v1`, including route transitions, destination and direction, boss assignment and attempts, Round Summary Gold reconciliation, manual-reroll face exclusion, Caller calls and outcomes, Warden thresholds and choices, Hexer die activity, round attempts, Bust/checkpoint lifecycle, economy, enhancements, Vintage growth, source-aware scoring, Flame factors, Stoke records, and Shop spending.

Validation commands:

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
git diff --check
```
