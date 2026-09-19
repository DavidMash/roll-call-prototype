import { Badge, Group, Modal, SimpleGrid, Tabs, Text } from '@mantine/core';
import { CONFIG } from '../game/config';
import { enhancementCost, ENHANCEMENTS, ENHANCEMENT_IDS } from '../game/enhancements';
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
      <Tabs.List grow>
        <Tabs.Tab value="play">How to Play</Tabs.Tab><Tabs.Tab value="scoring">Scoring</Tabs.Tab>
        <Tabs.Tab value="hands">Hands</Tabs.Tab><Tabs.Tab value="enhancements">Enhancements</Tabs.Tab><Tabs.Tab value="flames">Flames</Tabs.Tab><Tabs.Tab value="shop">Shop</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="play" pt="md">
        <Text size="sm">Select a scorecard hand or select dice first, adjust the participating dice, then press <strong>Play</strong>. Played hands score once and are consumed unless Sustainable preserves them. Scored dice reroll after a non-winning hand unless an effect changes that.</Text>
        <Text size="sm" mt="sm">Each round grants {CONFIG.manualRerollsPerRound} manual die rerolls, charged once per selected die. Reach the goal to enter the shop. The run ends only when you are below the goal with no playable hand and no manual rerolls.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="scoring" pt="md">
        <Text size="sm"><strong>Score = final Pips × final Mult × final XMult.</strong> Physical faces contribute their literal value. A hand also begins with Base Pips and Base Mult based on its permanent level.</Text>
        <Text size="sm" mt="sm">XMult starts at ×1. Additive bonuses combine inside the base value, then multiplicative effects compound: <strong>(1 + additive bonuses) × multiplicative effects</strong>. XMult appears in live scoring after the run owns an XMult Flame.</Text>
        <Text size="sm" mt="sm">The full result may be fractional. Each hand or standalone effect awards <strong>Math.round(Pips × Mult × XMult)</strong> exactly once; the scorecard adds those whole-number awards.</Text>
        <Text size="sm" mt="sm">Effect Score holds standalone scores such as Jumping Bean. Category scores plus Effect Score always equal the round total.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="hands" pt="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          {HAND_IDS.map(hand => { const stats = handStats(hand, 1); return <div key={hand} className="help-item">
            <Group justify="space-between" gap="xs"><Text size="sm" fw={700}>{HANDS[hand].name}</Text><Text size="xs" c="violet">{stats.basePips} · ×{stats.baseMultiplier}</Text></Group>
            <Text size="xs" c="dimmed">{HAND_RULES[hand]}</Text>
          </div>;})}
        </SimpleGrid>
      </Tabs.Panel>
      <Tabs.Panel value="enhancements" pt="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          {ENHANCEMENT_IDS.map(id => <div key={id} className="help-item">
            <Group justify="space-between" gap="xs"><Text size="sm" fw={700}>{ENHANCEMENTS[id].name}</Text><Group gap={5}><Badge size="xs" color="yellow" variant="light">{enhancementCost(id)} gold</Badge><Badge size="xs" color={ENHANCEMENTS[id].stackable ? 'teal' : 'gray'} variant="light">{ENHANCEMENTS[id].stackable ? 'Stackable' : 'Unique'}</Badge></Group></Group>
            <Text size="xs" c="dimmed">{ENHANCEMENTS[id].description}</Text>
          </div>)}
        </SimpleGrid>
      </Tabs.Panel>
      <Tabs.Panel value="flames" pt="md">
        <Text size="sm" mb="sm">Every third cleared round opens a Flame Reward before the normal shop. Choose one of three distinct offers for free and attach it to one whole physical die. Each die has one Flame slot; choosing an occupied die replaces and permanently removes its old Flame. Flame-offer rerolls cost 5 Gold, then 10, 20, 40, and reset at the next reward.</Text>
        <Text size="sm" mb="sm"><strong>Scores in a hand</strong> means a die was selected to form the hand or successfully joined through Hitchhiker. Hitchhikers never help qualify the hand itself.</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          {FLAME_IDS.map(id => <div key={id} className="help-item"><Group gap="xs"><Text aria-hidden="true">🔥</Text><Text size="sm" fw={700}>{FLAMES[id].name}</Text></Group><Text size="xs" c="dimmed">{FLAMES[id].description}</Text></div>)}
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt="sm">Target Practice uses seeded tie handling to choose one fixed target from the three least-played Lower hands at round start, then marks it for the whole round. Well Trained has no fixed target; its projected bonus appears only on the currently selected row and uses deterministic selected scoring dice.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="shop" pt="md">
        <Text size="sm"><strong>Hand Training</strong> costs {CONFIG.handTrainingCost} gold and permanently increases that hand’s Base Pips and Base Mult for the run. The three training offers are fixed for that shop.</Text>
        <Text size="sm" mt="sm"><strong>Enhancements</strong> attach to the exact exposed physical face. Drag an offer to a die, or select it and click a die. Purchased slots remain empty until the enhancement offers are rerolled.</Text>
        <Text size="sm" mt="sm"><strong>Exposed faces</strong> can be rerolled separately in the shop. Weighted affects those real rolls; scoring abilities wait for gameplay. Shop reroll prices increase according to the existing cost shown on each action.</Text>
        <Text size="sm" mt="sm">After rounds 3, 6, 9, and so on, the Flame Reward rolls the exposed dice first. Weighted and Clockwork apply; scoring effects, Magnetic, and Charge do not. Those exact faces carry into the shop after a Flame is chosen.</Text>
      </Tabs.Panel>
    </Tabs>
  </Modal>;
}
