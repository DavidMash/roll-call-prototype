# Roll Call prototype

Roll Call is a deterministic React/TypeScript/Vite dice roguelike. The domain engine resolves actions synchronously and emits immutable events and board snapshots; React only plays those snapshots. Playback speed cannot change outcomes.

The browser keeps one active run in local storage. Refreshing the page or returning without a `seed` query resumes the latest settled game state; when no saved run exists, the game generates a random seed. An interrupted event playback or map transition is skipped. A matching `?seed=` resumes that save, while a different explicit seed starts a fresh run and replaces it. Starting, restarting, or generating a run also replaces the saved run. Playback speed, selections, dialogs, and other transient UI state are not saved.

## Rounds, lives, and Busts

Choose a legal Yahtzee-style hand, select its physical dice, and play it. A played category is consumed for the round. Each attempt grants three manual die rerolls, charged once per selected die. A manual gameplay reroll always changes that die's printed face: the engine removes the current face from the normal seeded weighted distribution and samples once. Automatic, effect-driven, Boss-entry, and Shop rolls may still repeat naturally; Bump keeps its deterministic precedence.

A run starts with `3 / 3` lives. When score is below target, no legal unconsumed hand remains, and no manual rerolls remain, the attempt Busts. The engine restores the checkpoint captured when the player committed to the attempt, subtracts one life, increments the attempt number, and pauses on a Bust screen until the player continues to the restored Shop. The failed round does not restart automatically: the player may continue preparing, then explicitly choose `RETRY ROUND N`. Each attempt uses a deterministic seed derived from the run seed, round, and attempt, so retries are reproducible but do not repeat the same roll stream. A Bust that reduces lives to zero ends the run without reopening the Shop.

The checkpoint prevents failed-attempt farming. Score, consumed hands, dice, rerolls, gameplay Gold, Charge, Hot Streak, Workout, Personal Trainer levels, hand history, Vintage growth, and other attempt changes roll back. The Shop's offers, purchased cards, reroll progression, exposed faces, Gold, enhancements, Flames, and training return exactly as committed; it does not refresh or grant another reward. Shop changes made after a Bust become the checkpoint for the next retry, so earlier purchases stay committed and new purchases, sales, Stoke, and life restoration persist into that attempt.

Scoring remains:

```text
round(Pips × Mult × XMult)
```

Every XMult contribution is a multiplicative factor composed centrally. Ordinary Mult still comes from trained hand Base Mult.

## Run map and Boss cadence

Progression follows one linear route: `Round 1 → Shop → Round 2 → Shop → Boss Round 3 → Flame Selection → Shop`, then repeats. A local map transition fades in before every normal Round, Boss, Shop, and Flame Selection, then fades out when it advances. It shows at most five nearby nodes and uses stable node IDs such as `round:2`, `boss:3`, `flame:after-round:3`, and `shop:before-round:4`. Forward travel lights the connector from left to right in the destination theme; falling back after a Bust relights the last connector in Shop gold from right to left. It continues when the player clicks Continue or after three seconds. The Continue button shows the remaining seconds and fills from left to right during the countdown. Reduced-motion preferences remove the fades and fill animation without skipping the three-second countdown. Normal Rounds use blue (`#3B82F6`), Shops gold (`#F59E0B`), and Flame Selections red (`#EF4444`) over the shared dark foundation.

Every third round is a Boss encounter. Boss assignment is deterministic from the run seed and uses shuffled eight-boss bags: The Caller, The Warden, The Hexer, The Marathon, Quickdraw, The Fly, Snake Eyes, and The Infected all occur before a reshuffle, with boundary repeats avoided. The assignment is stored in run state, shown in the immediately preceding Shop, and remains stable on retry. Boss Reward starts at 10 Gold on round 3 and rises by 1 each subsequent Boss. Clearing one proceeds through Round Summary, the Flame Selection map transition, Flame Selection, and then the Shop transition.

### The Caller

The Caller (purple/magenta) continuously chooses an unused category from Ones through Sixes, Pair, Two Pair, Three of a Kind, Small Straight, and Full House. Calls are due on manual hands 3, 6, 9, and so on. An early answer reveals the next Call immediately without moving its deadline earlier. A matching Jumping Bean answers for free and does not advance the manual-hand counter. On a wrong hand at the deadline, that hand scores first; if it reaches the Boss target the encounter clears without a penalty, otherwise the current round score is halved and rounded before a new Call begins.

### The Warden

The Warden (cyan/teal) rolls all five player dice at encounter start, resolves only their landing mechanics, and then locks all five on those faces. The player chooses any die and confirms `UNLOCK DIE`. The four additional-die costs are frozen from the current Hand Training stats and the theoretical baseline capacity of the naturally possible hands, using ideal natural dice contribution and the game's five-point target interval. The first cost is capped by the two weakest Upper-hand baselines and half the Pair baseline; the second is clamped between twice the first cost and the Pair baseline. The final two costs use baseline capacity normally. If their cumulative total exceeds half the Boss Goal, all four costs are scaled proportionally so the final die unlocks at the rounded halfway point. Flames, Bonfires, XMult, Bonus, Workout growth, wild-card effects, and other enhancements do not inflate the schedule. Reaching an unlock target pauses play and allows another locked die to be chosen, unless the Boss target has been reached—in that case the encounter clears immediately. Unlocking retains the rolled face and is never a roll. Every remaining lock shows the same current target. Locked dice cannot score, be manually rerolled, trigger gameplay effects, or contribute attached Flames; global Bonfires remain active. A retry restores the pre-attempt state, rerolls all five for the new attempt, and returns to the initial choice.

### The Hexer

The Hexer (toxic green) adds a temporary boss-owned Cursed Die that must genuinely participate in every manual scoring hand. It remains freely selectable and rerollable like every other die; scorecard rows only become playable when a valid combination can include it. Its authored faces are:

| Face | Enhancements |
|---:|---|
| 1 | Golden 1, Weighted → 6 |
| 2 | Golden 1, Weighted → 5 |
| 3 | Golden 1, Weighted → 4 |
| 4 | Missing Link, Mirror |
| 5 | Workout 5, Mirror |
| 6 | Workout 10, Bump |
| 7 | Bonus 5, Mirror |

Bump on face 6 advances `6 → 7` and does not wrap. Seven is a genuine rank, so Small Straight recognizes `4-5-6-7` and Large Straight recognizes `3-4-5-6-7`. The Cursed Die cannot own Flames and is removed after a clear or failed-attempt rollback.

### The Marathon

The Marathon triples the normal target. A manually played hand enters a seven-manual-play cooldown instead of being permanently consumed; each later manual hand reduces existing cooldowns by one. Jumping Bean free plays neither enter nor advance cooldowns.

### Quickdraw

Quickdraw uses one third of the normal target, rounded to the normal five-point target interval. Only one Lower-section hand can be manually played during the attempt; Upper hands remain normal, and the Lower shot is optional.

### The Fly

The Fly marks an unused Lower row. All hands score with a final `×0.5` Boss factor until that marked hand is played; the catching hand and every later hand score in full. Every non-catching hand, including Jumping Bean, moves the Fly to another unused Lower row when possible.

### Snake Eyes

After every scoring hand, Snake Eyes deterministically converts up to two eligible participating physical faces into genuine value-1 faces for that attempt. Enhancements stay attached to those physical sides. Mutations roll back on Bust and disappear after the encounter.

### The Infected

One physical face on every player die starts infected. An infected face keeps its value for hand qualification but contributes 3 fewer Pips, to a minimum of 0; the penalty applies after permanent face-Pip gains such as Workout. Its attached enhancements are disabled, while whole-die Flames and Bonfires still work. An exposed infected face spreads to clean landing faces on other dice using one snapshot generation per roll batch. Infection rolls back on Bust and disappears after the encounter.

## Gold and the Shop

The normal Shop is the only place Gold is spent. It contains enhancement purchases and refreshes, Hand Training, paid dice rerolls, Flame Stoke controls, and life restoration. Individual Hand Training offers are repeatable within a Shop and cost `2, 4, 8, 16…` independently per hand. Team Training can replace one of the three training slots, raises every hand by one level, and costs `15, 30, 60, 120…` independently. A newly reached Shop resets training prices; returning to the same Shop after a Bust preserves them. Gold may still be earned during scoring.

Every successful clear pays, in order:

- 5 base Gold;
- 1 Gold per unused manual reroll;
- `min(10, floor(heldGold / 5))` interest using the pre-payout Gold snapshot;
- Escalating Boss Reward after successfully defeating a Boss: 10 Gold on round 3, 11 on round 6, 12 on round 9, and so on.

A failed attempt pays none of these rewards. Interest is +1 per 5 Gold held, reaches its +10 maximum at 50 Gold, and is snapshotted after scoring Gold effects but before base, reroll, interest, or Boss Reward payouts are added. The maximum standard normal-round payout is 18 Gold; the Boss maximum rises with its round, excluding scoring Gold such as Golden and Jackpot.

Every successful encounter pauses on a concise Round Summary before the next map transition. Its domain-owned snapshot shows score/target, Gold before and after, total Gold earned, and reconciled aggregate rows for Base Reward, unused rerolls, interest, Golden, Jackpot, other gameplay Gold, and Boss Reward when applicable. Bust attempts never create a successful summary.

Lost lives can be restored one at a time only in a normal Shop. Each newly reached Shop starts the prices at `25, 40, 60, 90, 130, 180, 240, 310, 390, 480…`; after 390, each new increment is 10 larger than the prior increment. A Bust return preserves the same Shop's escalation, while the next new Shop resets it to 25. Restoration spending counts toward Money to Burn, and lives cannot exceed three.

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
| Personal Trainer | 8 | 4 |

Sticky and Slippy now cost 2 Gold; their gameplay behavior is unchanged.

While held, a showing Magnetic face pulls eligible rolling dice onto their Magnetic faces. A physical Magnetic face can perform this source pull once per Round; being pulled does not spend its source use, destinations do not exhaust, and source use resets at the start of each Round. Bump retains roll-resolution priority.

Jumping Bean and Magnetic remain nonstackable on a Face, and each is limited to one Face per physical die. Different dice may each carry their own Jumping Bean and Magnetic Face.

### Vintage

Vintage is unique and non-stackable. A new instance starts with a 0-Gold sell value and has no direct scoring effect. Whenever its physical face participates in a resolved scoring hand, its sell value increases by 3 Gold exactly once. Selected dice, successful Hitchhikers, and Jumping Bean free plays qualify; rolls, displayed faces, failed Hitchhikers, Shop rolls, and Flame Selection rolls do not. Separate Bean-chain hand resolutions may each grow it.

Vintage has no value cap and may exceed its 3-Gold purchase price. Selling pays its current value and deletes that accumulated state; repurchasing starts at 0. Failed-attempt growth rolls back with the round checkpoint.

### Personal Trainer

Personal Trainer is stackable to three. Each scoring face checks independently after its hand's score is awarded, starting from a 50%, 75%, or 87.5% base chance and scaling down according to the played hand's level relative to the full scorecard. Lowest-level hands retain the full base chance, average-level hands use 75% of it, above-average hands fall off more quickly, and the effective chance never drops below 1%. Each check recalculates immediately before it rolls, so one success can affect the next check in the same hand. A success raises that hand by one level. Selected scoring dice, successful Hitchhikers, and Jumping Bean free plays qualify; rolls and merely exposed faces do not. Multiple successes can train one hand multiple times, and failed-attempt gains roll back with the round checkpoint.

## Flame Selections, Embers, and Bonfires

Every third successful clear adds the escalating Boss Reward, shows its Round Summary, and then opens the special Flame Selection before the Shop. This screen only allows the player to select one of the three deterministic distinct offers and assign it to a physical die, or skip. There are no paid offer rerolls and no Stoke controls on Flame Selections. If every Flame is currently owned as an Ember or Bonfire, the screen reports that all Flames are collected and continues normally to the Shop; a replaced Ember becomes eligible for a later selection again.

New Flames begin as 0-Gold Embers. The immediately following Shop shows a one-time controlled tooltip on the first Flame’s die, teaching the player to click the die, Stoke it, and reach Bonfire at 100 Gold. All Flame investment occurs through Manage Die in a normal Shop. Arbitrary positive whole-Gold Stoke amounts are supported and do not count toward Money to Burn spending.

At exactly 100 invested Gold an Ember becomes a global Bonfire, detaches from its die, and cannot be reacquired. Replacing an active Ember during a later Flame Selection destroys its investment. The threshold and all Flame formulas remain unchanged.

Let `p = investedGold / 100`, clamped to `[0, 1]`. Every XMult Flame returns a factor and scoring applies `XMult *= factor`.

| Flame | Active rule |
|---|---|
| Ultimate | The single highest-ranked hand: `1 + 4p`, max ×5 |
| Minigun | Ones–Sixes: `1 + 4p`, max ×5 |
| Hail Mary | Zero rerolls: `1 + 4p`, max ×5 |
| Full of Grace | LAST PLAY (zero rerolls and exactly one playable hand): `1 + 4p`, max ×5 |
| Momentum | Each manually played or Jumping Bean hand adds `0.5p` Charge |
| Third Rail | Each gameplay die that rolls a 3 adds `0.5p` Charge |
| Jump Start | Each manual Reroll spent adds `2p` Charge |
| Power Surge | The single Ultimate-ranked hand triples current Charge |
| Speed Demon | Actual unblocked decision time: full strength for 1 second, then smooth decay to ×1 at about 10 seconds; peak `1 + 8p` |
| Six Pack | Starts each Round at `S = 1 + 5p`; after `n` played Upper hands its factor is `1 + (S - 1)(1 - n/6)`, floored at ×1 |
| Flux Capacitor | One Magnetic source activation that pulls `m` Magnetic faces multiplies current Charge by `1 + mp`, clamped to Max Charge |
| Dragon's Hoard | `1 + 4p × min(heldGold/100, 1)`, max ×5 |
| Well Trained | `min(5, 1 + previousPlays × 0.2p)` |
| Target Practice | Targeted Lower hand: `1 + 8p`, max ×9 |
| Hot Streak | `1 + successfulCharges × p` |
| Money to Burn | `1 + 4p × min(shopSpend/100, 1)`, max ×5 |
| Lowball | `1 + 2 × (printedFaceTier − 1) × p`, max ×5 |
| Straight Shooter | Play Small Straight, then pay once on Large Straight: `1 + 8p`, max ×9 |
| Double Down | Play Pair, then pay once on Two Pair: `1 + 8p`, max ×9 |
| Three’s Company | Play Three of a Kind, then pay once on Full House: `1 + 8p`, max ×9 |
| Box Set | Play Four of a Kind, then pay once on Five of a Kind: `1 + 8p`, max ×9 |
| Missing Pair | Pair/Three of a Kind: `1 + 4p`, max ×5 |
| One Short | Small Straight/Four of a Kind: `1 + 4p`, max ×5 |

Each owned Charge-family Flame contributes `1 + 4p` Max Charge. Their capacity stacks into one shared meter. Before any Charge-family Bonfire, every attached family die must participate in the hand that spends Charge; any family Bonfire unlocks global use.

## Dice visuals and live scoring

Physical die faces use a shared scalable pip layout in gameplay, the Shop, Manage Die, Flame Selection, and Warden choices. Faces 1–6 use standard real-die arrangements; the Hexer's impossible 7 uses the six-pip arrangement plus a center pip. Numeric face and scoring labels remain available in details and accessibility text. During Round and Boss gameplay, the live Pips / Mult / XMult panel sticks immediately below the measured global HUD while the scorecard scrolls.

## Telemetry and validation

Run Info exports schema 17 / `flame-magnetic-sequences-v1`, including route transitions, destination and direction, boss assignment and attempts, Round Summary Gold reconciliation, manual-reroll face exclusion, Caller calls and outcomes, Warden unlock targets and choices, Hexer die activity, round attempts, Bust/checkpoint lifecycle, economy, enhancements, Vintage growth, source-aware scoring, Flame factors and sequence stages, Magnetic source use, Stoke records, and Shop spending.

Validation commands:

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
git diff --check
```
