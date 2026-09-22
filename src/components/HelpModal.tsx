import { Badge, Group, Modal, SimpleGrid, Tabs, Text } from '@mantine/core';
import { CONFIG } from '../game/config';
import { enhancementCost, ENHANCEMENTS, ENHANCEMENT_IDS, FACE_TYPE_LIMIT } from '../game/enhancements';
import { FLAMES, FLAME_IDS } from '../game/flames';
import { handStats, HANDS, HAND_IDS } from '../game/hands';
import type { HandId } from '../game/types';

const HAND_RULES: Record<HandId, string> = {
  ones: 'Any non-empty subset of Ones.', twos: 'Any non-empty subset of Twos.', threes: 'Any non-empty subset of Threes.',
  fours: 'Any non-empty subset of Fours.', fives: 'Any non-empty subset of Fives.', sixes: 'Any non-empty subset of Sixes.',
  pair: 'Two matching dice.', twoPair: 'Two different pairs using four dice.', threeKind: 'Three matching dice.',
  smallStraight: 'Four consecutive ranks.', fullHouse: 'Three of one rank and two of another.', fourKind: 'Four matching dice.',
  largeStraight: 'Five consecutive ranks.', fiveKind: 'Five matching dice.',
};
export function HelpModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return <Modal opened={opened} onClose={onClose} title="How to Play" size="xl" centered transitionProps={{ duration: 0 }}>
    <Tabs defaultValue="play">
      <Tabs.List grow><Tabs.Tab value="play">How to Play</Tabs.Tab><Tabs.Tab value="scoring">Scoring</Tabs.Tab><Tabs.Tab value="hands">Hands</Tabs.Tab><Tabs.Tab value="enhancements">Enhancements</Tabs.Tab><Tabs.Tab value="flames">Flames</Tabs.Tab><Tabs.Tab value="shop">Shop</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="play" pt="md">
        <Text size="sm">Select a scorecard hand and its participating dice, then Play. Every hand is consumed after use. Each round grants {CONFIG.manualRerollsPerRound} manual die rerolls, charged once per selected die.</Text>
        <Text size="sm" mt="sm">Every clear pays 5 base Gold, 1 per unused reroll, and interest equal to floor(held Gold / 5), capped at 5. Scoring Gold is included before interest is calculated, so the maximum round-clear payout is 13 Gold.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="scoring" pt="md"><Text size="sm"><strong>Score = round(Pips × Mult × XMult).</strong> Ordinary Mult comes only from the played hand’s trained Base Mult. Every applicable XMult factor multiplies with every other factor; XMult defaults to ×1.</Text><Text size="sm" mt="sm">Jumping Bean free-plays the matching Upper hand using only its die. It uses trained hand stats, counts in play history, can trigger applicable Flames, and may chain, but never consumes or requires that hand’s normal use. Hitchhiker does not join a Bean free play.</Text></Tabs.Panel>
      <Tabs.Panel value="hands" pt="md"><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{HAND_IDS.map(hand => { const stats = handStats(hand, 1); return <div key={hand} className="help-item"><Group justify="space-between"><Text size="sm" fw={700}>{HANDS[hand].name}</Text><Text size="xs" c="violet">{stats.basePips} · ×{stats.baseMultiplier}</Text></Group><Text size="xs" c="dimmed">{HAND_RULES[hand]}</Text></div>; })}</SimpleGrid></Tabs.Panel>
      <Tabs.Panel value="enhancements" pt="md">
        <Text size="sm" mb="sm">A physical face holds at most {FACE_TYPE_LIMIT} distinct enhancement types. Extra stacks of an existing type use no new slot. Sticky and Hitchhiker cap at 3 stacks (87.5%); Golden and Jackpot also cap at 3. Sustainable and the Multiplier enhancement have been removed. During a normal shop, any enhancement type can be scrapped from any face for no refund.</Text>
        <Text size="sm" mb="sm"><strong>Roll priority:</strong> Bump first, then attraction from a held Magnetic anchor, then Weighted/random. Landing on Bump only arms the next separate roll. A Magnetic anchor must already be showing and held outside the roll batch.</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{ENHANCEMENT_IDS.map(id => <div key={id} className="help-item"><Group justify="space-between"><Text size="sm" fw={700}>{ENHANCEMENTS[id].name}</Text><Group gap={4}><Badge size="xs" color="yellow">{enhancementCost(id)} Gold</Badge><Badge size="xs">{ENHANCEMENTS[id].maxStacks ? `Max ${ENHANCEMENTS[id].maxStacks}` : ENHANCEMENTS[id].stackable ? 'Stackable' : 'Unique'}</Badge></Group></Group><Text size="xs" c="dimmed">{ENHANCEMENTS[id].description}</Text></div>)}</SimpleGrid>
      </Tabs.Panel>
      <Tabs.Panel value="flames" pt="md">
        <Text size="sm" mb="sm">Every third clear opens one unified Flame screen. New Flames are 0-Gold embers with no meaningful effect. Donate any whole Gold amount to active Flames only on this screen. At exactly 100, a Flame becomes a global Bonfire, detaches from its die, and triggers once globally.</Text>
        <Text size="sm" mb="sm">Flame types are unique: an active or Bonfire type cannot be offered again. You may replace an active Flame and lose its investment, acquire at most one per reward, or skip acquisition and continue to the shop. Offer rerolls cost 5, 10, 20, 40…</Text>
        <Text size="sm" mb="sm">Charge stores gameplay-roll power and only applies after you explicitly arm it; it resets when used or at the next round. Hot Streak follows Pair → Two Pair → Three Kind → Small Straight → Full House → Four Kind → Large Straight → Five Kind. Future hands played early do not reset the goal, but are skipped later with no retroactive charge.</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{FLAME_IDS.map(id => <div key={id} className="help-item"><Text size="sm" fw={700}>🔥 {FLAMES[id].name}</Text><Text size="xs" c="dimmed">{FLAMES[id].description}</Text><Text size="xs" c="orange">Bonfire: {FLAMES[id].bonfireDescription}</Text></div>)}</SimpleGrid>
        <Text size="xs" c="dimmed" mt="sm">Money to Burn tracks lifetime normal-shop spending only and caps its spend factor at 100 Gold. Dragon’s Hoard snapshots held Gold at hand start. Lowball averages printed/current faces, including successful Hitchhikers, not Bonus or Workout pips.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="shop" pt="md"><Text size="sm">Hand Training still costs {CONFIG.handTrainingCost} Gold. Enhancement purchases require the exposed face, while destructive scrapping can manage any physical face. Paid dice rerolls cost 2, 4, 8, 16… and reset each shop.</Text><Text size="sm" mt="sm">Flame Reward dice carry into the following shop. The carried roll is not a paid reroll and the first paid reroll still costs 2.</Text></Tabs.Panel>
    </Tabs>
  </Modal>;
}
