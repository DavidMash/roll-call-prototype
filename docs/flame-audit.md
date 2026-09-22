# Flame system audit

`p` is invested Gold divided by 100, clamped to `[0, 1]`. `g` is held Gold capped at 100 and normalized to `[0, 1]`; `s` is lifetime normal-shop spend normalized the same way; `n` is previous plays of the hand; `c` is the successful Hot Streak charge count including the current qualifying step; and `T` is Lowball's printed-face tier from ×1 to ×3.

Every XMult entry below produces an `XMultFactor`. The hand accumulator applies `XMult *= factor`; multiple entries are multiplied canonically. Personal Trainer is the only catalog Flame that does not affect XMult.

| Flame | Category | Before | After | XMult? | Scalable? |
|---|---|---|---|---:|---:|
| Ultimate | Conditional highest-level hand | `1 + 2p`, max ×3 | `1 + 4p`, max ×5 | Yes | Yes |
| Minigun | Conditional Upper hand | `1 + 2p`, max ×3 | `1 + 4p`, max ×5 | Yes | Yes |
| Hail Mary | Conditional zero-reroll hand | `1 + 2p`, max ×3 | `1 + 4p`, max ×5 | Yes | Yes |
| Charge | Stored factor from gameplay rolls | Stored factor gained `0.5p` per roll; armed factor multiplied into hand | Stored factor gains `p` per roll; armed factor multiplied into hand | Yes | Yes |
| Personal Trainer | Post-score training chance | `0.75p` | `min(0.75, 1.5p)`; reaches the same 75% cap sooner | No | Yes |
| Dragon's Hoard | Held-Gold factor | `1 + 2pg`, max ×3 | `1 + 4pg`, max ×5 | Yes | Yes |
| Well Trained | Hand-history factor | `min(3, 1 + 0.1np)` | `min(5, 1 + 0.2np)` | Yes | Yes |
| Target Practice | Targeted Lower-hand factor | `1 + 4p`, max ×5 | `1 + 8p`, max ×9 | Yes | Yes |
| Hot Streak | Ordered Lower-sequence factor | `1 + 0.5cp` | `1 + cp` | Yes | Yes |
| Money to Burn | Normal-shop-spend factor | `1 + 2ps`, max ×3 | `1 + 4ps`, max ×5 | Yes | Yes |
| Lowball | Printed-face-average factor | `1 + (T − 1)p`, max ×3 | `1 + 2(T − 1)p`, max ×5 | Yes | Yes |
| Straight Shooter | Straight-hand factor | `1 + 2p`, max ×3 | `1 + 4p`, max ×5 | Yes | Yes |
| Double Down | Pair-hand factor | `1 + 2p`, max ×3 | `1 + 4p`, max ×5 | Yes | Yes |

Bonfires continue to use each Flame's full-progress formula globally and still require exactly 100 invested Gold. Charge Bonfire roll growth changes from +0.5 to +1 as the full-progress result of the revised Charge curve. Personal Trainer remains capped at 75%.

## Flow audit

- New Flame acquisition remains exclusive to the every-third-clear Flame Reward. The existing +5 Flame Bonus and one-acquisition limit are unchanged.
- The same `STOKE_FLAME` domain action now accepts both `flameReward` and `shop` phases. It validates whole positive Gold, held Gold, active ownership, and the 100-Gold cap once.
- Shop Stoke is reached through the owned Flame's physical die and Manage Die context. It does not expose Flame offers, acquisition, or replacement.
- Stoke telemetry records the source (`flame_reward` or `shop`), round, die, Flame, amount, previous investment, and resulting investment. Bonfire completion remains a separate record.
- UI effect text comes from shared domain selectors used by both Shop and Flame Reward screens. Scoring playback reports the prior XMult, the Flame factor, and their product.

## Named non-catalog checks

- **Weighted** is a face enhancement that changes roll weights. It is not a Flame and contributes no XMult factor.
- **Clockwork** is not in the current Flame catalog. It appears only as a deprecated/stale identifier in normalization coverage and contributes no XMult factor.
