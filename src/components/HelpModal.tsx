import { Badge, Group, Modal, SimpleGrid, Tabs, Text } from '@mantine/core';
import { CONFIG, lifeRestoreCost } from '../game/config';
import { enhancementCost, ENHANCEMENTS, ENHANCEMENT_IDS, FACE_TYPE_LIMIT } from '../game/enhancements';
import { FLAMES, FLAME_IDS } from '../game/flames';
import { handStats, HANDS, HAND_IDS } from '../game/hands';
import type { HandId } from '../game/types';

const HAND_RULES: Record<HandId, string> = {
  ones: 'Any non-empty subset of Ones.', twos: 'Any non-empty subset of Twos.', threes: 'Any non-empty subset of Threes.',
  fours: 'Any non-empty subset of Fours.', fives: 'Any non-empty subset of Fives.', sixes: 'Any non-empty subset of Sixes.',
  pair: 'Two matching dice.', twoPair: 'Two different pairs using four dice.', threeKind: 'Three matching dice.',
  smallStraight: 'Four consecutive ranks; The Hexer enables 4-5-6-7.', fullHouse: 'Three of one rank and two of another.', fourKind: 'Four matching dice.',
  largeStraight: 'Five consecutive ranks; The Hexer enables 3-4-5-6-7.', fiveKind: 'Five matching dice.',
};

export function HelpModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return <Modal opened={opened} onClose={onClose} title="How to Play" size="xl" centered transitionProps={{ duration: 0 }}>
    <Tabs defaultValue="play">
      <Tabs.List grow><Tabs.Tab value="play">How to Play</Tabs.Tab><Tabs.Tab value="bosses">Bosses</Tabs.Tab><Tabs.Tab value="scoring">Scoring</Tabs.Tab><Tabs.Tab value="hands">Hands</Tabs.Tab><Tabs.Tab value="enhancements">Enhancements</Tabs.Tab><Tabs.Tab value="flames">Flames</Tabs.Tab><Tabs.Tab value="shop">Shop</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="play" pt="md">
        <Text size="sm">Select a scorecard hand and its participating dice, then Play. Every hand is consumed after use. Each round grants {CONFIG.manualRerollsPerRound} manual die rerolls, charged once per selected die. A manual gameplay reroll always changes the printed face; automatic and effect-driven rolls may repeat.</Text>
        <Text size="sm" mt="sm">A run starts with 3 lives. With no playable hands and no rerolls, the attempt Busts: one life is lost, failed-attempt gains are rolled back, and the exact pre-attempt Shop reopens without refreshing. Prepare there, then use Retry Round to begin another deterministic attempt of the same round. A Bust at 1 life leaves 0 and ends the run instead.</Text>
        <Text size="sm" mt="sm">Every clear pays 5 base Gold, 1 per unused reroll, and +1 interest per 5 Gold held, capped at +10 when holding 50 Gold. Scoring Gold is included in the pre-payout interest snapshot; the payout itself is not. Defeating a Boss then adds a +10 Boss Reward. A Gold-focused Round Summary reconciles every successful encounter before the next map transition.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="bosses" pt="md">
        <Text size="sm">The local run map appears between destinations. Every third round is a Boss; clearing it uses the normal target and payout, then opens the usual Flame Selection and Shop. Bosses come from a seeded no-repeat bag: all three appear once before reshuffling, with no immediate repeat.</Text>
        <div className="help-item"><Text fw={800}>THE CALLER</Text><Text size="sm">Complete the revealed called hand within three manual plays. A matching Jumping Bean free play satisfies the call without reducing the count. Three nonmatching manual plays Bust the attempt.</Text></div>
        <div className="help-item"><Text fw={800}>THE WARDEN</Text><Text size="sm">Choose one starting die; the other four are locked. Crossing 10%, 25%, 45%, and 70% of the target releases one chosen die with a real gameplay roll. Multiple crossed checkpoints queue and resolve one choice at a time. Locked dice cannot play, reroll, or use attached Flames; Bonfires remain global.</Text></div>
        <div className="help-item"><Text fw={800}>THE HEXER</Text><Text size="sm">A temporary boss-owned seven-sided Cursed Die joins the pool and must participate in every manual hand. It can reroll and use its authored enhancements normally. Bump advances 4→5→6→7 without wrapping; rank 7 supports 4-5-6-7 and 3-4-5-6-7 straights and Mirror matching. The die disappears after clear or rollback.</Text></div>
      </Tabs.Panel>
      <Tabs.Panel value="scoring" pt="md"><Text size="sm"><strong>Score = round(Pips × Mult × XMult).</strong> Ordinary Mult comes only from the played hand’s trained Base Mult. Every applicable Flame produces a factor and resolves as <strong>XMult ×= factor</strong>; multiple factors multiply and XMult defaults to ×1.</Text><Text size="sm" mt="sm">Jumping Bean free-plays the matching Upper hand using only its die. It uses trained hand stats, counts in play history, can trigger applicable Flames and Vintage, and may chain, but never consumes that hand’s normal use. Hitchhiker does not join a Bean free play.</Text></Tabs.Panel>
      <Tabs.Panel value="hands" pt="md"><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{HAND_IDS.map(hand => { const stats = handStats(hand, 1); return <div key={hand} className="help-item"><Group justify="space-between"><Text size="sm" fw={700}>{HANDS[hand].name}</Text><Text size="xs" c="violet">{stats.basePips} · ×{stats.baseMultiplier}</Text></Group><Text size="xs" c="dimmed">{HAND_RULES[hand]}</Text></div>; })}</SimpleGrid></Tabs.Panel>
      <Tabs.Panel value="enhancements" pt="md">
        <Text size="sm" mb="sm">A physical face holds at most {FACE_TYPE_LIMIT} distinct enhancement types. Extra stacks of an existing type use no new slot. Selling in a normal Shop removes every stack of that type from the face and immediately pays the displayed total sale value.</Text>
        <Text size="sm" mb="sm"><strong>Vintage:</strong> costs 3 Gold, starts with a 0-Gold sell value, and gains +3 whenever its physical face scores in a hand—including successful Hitchhiker and Jumping Bean free plays. It has no scoring bonus or value cap, and failed-attempt growth rolls back.</Text>
        <Text size="sm" mb="sm"><strong>Roll priority:</strong> Bump first, then attraction from a held Magnetic anchor, then Weighted/random. Landing on Bump only arms the next separate roll.</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{ENHANCEMENT_IDS.map(id => <div key={id} className="help-item"><Group justify="space-between"><Text size="sm" fw={700}>{ENHANCEMENTS[id].name}</Text><Group gap={4}><Badge size="xs" color="yellow">Buy {enhancementCost(id)}</Badge><Badge size="xs" color="teal">Sell {id === 'vintage' ? '0+' : ENHANCEMENTS[id].baseSellPrice}</Badge><Badge size="xs">{ENHANCEMENTS[id].maxStacks ? `Max ${ENHANCEMENTS[id].maxStacks}` : ENHANCEMENTS[id].stackable ? 'Stackable' : 'Unique'}</Badge></Group></Group><Text size="xs" c="dimmed">{ENHANCEMENTS[id].description}</Text></div>)}</SimpleGrid>
      </Tabs.Panel>
      <Tabs.Panel value="flames" pt="md">
        <Text size="sm" mb="sm">Every third clear adds a +10 Boss Reward, shows the Round Summary, and opens the special Flame Selection only to choose and assign one new Flame, or skip. Its three seeded offers cannot be rerolled and no Gold is spent there.</Text>
        <Text size="sm" mb="sm">New Flames begin as 0-Gold Embers. Click their physical die in a normal Shop to open Manage Die and Stoke any whole Gold amount. At exactly 100, a Flame becomes a global Bonfire and detaches. Replacing an active Flame destroys its investment.</Text>
        <Text size="sm" mb="sm">Charge stores gameplay-roll power and only applies after you arm it; it resets when used or at the next round. Hot Streak follows Pair → Two Pair → Three Kind → Small Straight → Full House → Four Kind → Large Straight → Five Kind.</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{FLAME_IDS.map(id => <div key={id} className="help-item"><Text size="sm" fw={700}>🔥 {FLAMES[id].name}</Text><Text size="xs" c="dimmed">{FLAMES[id].description}</Text><Text size="xs" c="orange">Bonfire: {FLAMES[id].bonfireDescription}</Text></div>)}</SimpleGrid>
        <Text size="xs" c="dimmed" mt="sm">Money to Burn tracks normal-Shop spending on purchases, training, rerolls, and restored lives. Stoke and sales do not increase it.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="shop" pt="md"><Text size="sm"><strong>The normal Shop is the only place Gold is spent.</strong> It contains Hand Training ({CONFIG.handTrainingCost} Gold), enhancement purchases/refreshes, paid dice rerolls, Flame Stoke controls, and life restoration. Restore prices begin {lifeRestoreCost(0)}, {lifeRestoreCost(1)}, {lifeRestoreCost(2)}, {lifeRestoreCost(3)} Gold and keep escalating for the run.</Text><Text size="sm" mt="sm">With no offer selected, select a die to open Manage Die, inspect all six faces, sell enhancements, and Stoke its Ember. A fourth-type attempt preserves the pending offer while you sell one type to make room.</Text><Text size="sm" mt="sm">Flame Selection dice carry into the following Shop. The carried roll is not a paid reroll and the first paid reroll still costs 2.</Text></Tabs.Panel>
    </Tabs>
  </Modal>;
}
