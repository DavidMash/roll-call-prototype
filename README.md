# Roll Call prototype

Roll Call is a deterministic React/TypeScript/Vite dice roguelike. The domain engine resolves typed actions synchronously, records structured history, and emits immutable board snapshots for React playback. Playback speed and UI state cannot change an outcome.

## Current game model

A run owns collectible dice with stable IDs. `diceInventory.instances` is the die-object authority, while five fixed Roster slots and five fixed Storage slots are the location authority. New runs start with five Normal dice equipped and five empty Storage slots, for a maximum collection of ten dice. A die ID is never a Roster position.

`Board.dice` is the active encounter reference projection. Its player entries alias the equipped inventory instances in Roster order, followed by any tagged temporary encounter dice. The array is rebuilt from inventory/encounter authority and must never be used to infer ownership or Storage membership. This compact projection is retained for resolution, playback, and Round UI.

Each collectible die owns an independent list of effect instances. Normal dice have no effects; a Shop die begins with one. Fusion adds levels when one input's effect set contains the other, while a true Forge combines different effect sets. Die A keeps its stable identity and Die B is consumed. The Shop uses rarity-first seeded offer generation. Storage dice do not Roll, Score, activate, or participate in encounter logic.

## Play, Score, and Roll

The resolver keeps these concepts separate:

- Qualification is a pure legality plan. Invocation claims are spent only when a Play commits.
- A Play commits selected dice to one hand. A normal Play consumes the hand unless preserved and schedules post-Play rerolls.
- A Free Play scores without normal hand consumption or automatic post-Play rerolls.
- A Score occurrence represents one die genuinely scoring. Hitchhiker adds a scorer; Lone Wolf and Double Time add occurrences. Double Time occurrences suppress only further Double Time recursion.
- A Roll intent records the die, batch, reason, and whether it is an initial Roll or Reroll.
- Roll arbitration selects one controller without extra RNG. The face is installed before post-Roll reactions enqueue generated actions.

Scoring is authoritative domain arithmetic:

```text
round(Inferno × Pips × Mult × XMult × Boss factor)
```

Hand Base Pips and Base Mult come from the trained hand level. Composable effects contribute through typed Score, Qualification, Roll-controller, and post-Roll boundaries. Roll controllers use a fixed priority and only the winning controller spends a use.

## Rounds, Busts, and persistence

Each attempt starts with three manual reroll charges. A manual Reroll excludes the die's current ordinary face from the seeded distribution. Automatic and controller-driven Rolls follow their explicit rules. Temper is earned from encounter and Flame milestones and persists as the Forge currency.

When the score is below the target and no legal hand or reroll remains, the attempt Busts. The Round checkpoint restores the committed build and Shop visit, subtracts a life, and increments the attempt number. Players return to the same semantic Shop before retrying. Attempt-local score, consumed hands, exposed faces, Invocations, temporary die growth, Charge, and other Round state roll back; committed collection, Training, and Fire Keeping transactions remain.

The browser stores one active current-schema run. Persistence is deliberately versioned without old-prototype migration. A mismatched schema is rejected and a new run may be started. Rollback snapshots preserve inventory slots, stable die IDs, Shop session state, global Flames, and RNG state.

## Shop

One authoritative Shop visit has one `visitId` and a persisted stage:

```text
SHOP | FORGE | TRAIN | FLAMES
```

Navigation consumes no RNG and does not rebuild offers or session state. FORGE appears permanently after the run first earns Temper; FLAMES appears only while the player owns a Flame. Bust restoration keeps the visit and returns its view to SHOP.

- SHOP has three persistent seeded offers plus Roster/Storage movement, selling, details, and Weighted configuration. Offer rerolls remain available; owned dice are not physically rerolled in the Shop.
- FORGE combines two special dice through Fusion or true Forge, charging the previewed Temper cost.
- TRAIN displays the scorecard and allows every hand to be trained repeatedly.
- FLAMES manages the five global Flame slots. The bottom CTA advances through available sections and exits from the final one.

Special Offers and Flame Selection are post-Boss rewards outside the normal staged Shop.

## Training

At semantic Shop creation, Training freezes all six Upper and all eight Lower entry levels. Each family's baseline is its rounded arithmetic mean. A hand at or below its frozen baseline costs 2 Gold; each level above the baseline doubles the next cost:

```text
relativeTier = max(0, currentLevel - frozenBaseline)
cost = 2 × 2^relativeTier
```

Training one hand never changes another hand's quote during that visit. On The House waives the first individual Training purchase. Team Training is an Uncommon Special Offer that raises every hand by one before the next Shop captures its baselines.

## Flames and Inferno

The player has five global Flame slots. A Flame has stable instance identity, type, slot, investment, and Ember/Bonfire stage; it is never carried by a die. Acquisition fills the first empty slot or explicitly replaces a chosen occupied slot. Fire Keeping accepts positive whole-Gold investments. At 100 invested Gold an Ember becomes a Bonfire in the same slot and keeps its identity.

A Flame's written condition is its complete activation condition. Investment scales strength without changing that condition. Charge gains are attributed to Flame instance IDs. Engulfment consumes selected Flame instances, advances permanent Inferno level on success, and unifies Upper and Lower hand levels as defined by the frozen evaluation. Inferno contributes an exact `25^level` multiplier.

## Bosses

Boss selection is deterministic and stored in the Chapter plan. Every current Boss is safe with one to five equipped dice and ignores Storage.

- Caller selects only physically attainable calls.
- Warden derives its lock/reinforcement schedule from the encounter's equipped Roster.
- Hexer adds a tagged negative-ID Cursed Die with seven authored boss faces. Its face rules are dedicated encounter mechanics, not collectible effects.
- Marathon applies hand cooldowns; Quickdraw permits one Lower shot; Fly targets attainable Lower hands.
- Snake Eyes changes a scored physical face to 1 for the attempt.
- Infected marks physical faces and suppresses the exposed collectible effect while applying its Pips penalty.
- Juggler, Capital Return, Neglected, Tightrope, Crawler, Magician, and Mugger use explicit boss runtime state and current pipeline hooks.

Temporary boss dice occupy a separate identity namespace, are never owned, and never enter Roster or Storage.

## History and debugging

Run History V2 is the balance-analysis authority. It records semantic Shop visits, offer impressions, Dice and Forge transactions, Temper changes, Roster-at-Round-start effect snapshots, Score occurrences, effect activations and Invocation changes, Roll controllers, Training sessions/purchases, global Flame lifecycle, Charge attribution, Engulfment, Boss state, exact scores, economy, and rollback timelines.

The text export begins with Result, Final Build, Economy, and Balance summaries, followed by the chronological canonical/experienced history. Stable IDs remain visible in deep history where lifecycle joins matter; player-facing Round labels use Roster positions.

Debug traces are bounded reproduction data. Persistence compacts verbose playback/history arrays that already have a structured V2 owner while preserving critical diagnostics.

## Project commands

```sh
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run test:browser
git diff --check
```

Unit/component tests use Vitest. Browser flows use Playwright. Seeded tests should assert exact state/events and must not add incidental RNG calls.
