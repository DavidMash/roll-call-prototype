import { Modal, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core';
import { CONFIG } from '../game/config';
import { ENHANCEMENTS, ENHANCEMENT_IDS } from '../game/enhancements';
import { FLAMES, FLAME_IDS } from '../game/flames';
import { HANDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from '../game/hands';
import { BOSSES, BOSS_TYPES } from '../game/bosses';
import type { HandId } from '../game/types';

const LOWER_HAND_RULES: Partial<Record<HandId, string>> = {
  pair: 'Two matching Faces.',
  twoPair: 'Two different pairs.',
  threeKind: 'Three matching Faces.',
  smallStraight: 'Four consecutive Faces.',
  fullHouse: 'Three of one Face and two of another.',
  fourKind: 'Four matching Faces.',
  largeStraight: 'Five consecutive Faces.',
  fiveKind: 'Five matching Faces.',
};

function RuleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="help-item"><Title order={4}>{title}</Title><Text size="sm" mt={3}>{children}</Text></div>;
}

export function HelpModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return <Modal opened={opened} onClose={onClose} title="How to Play" size="xl" centered transitionProps={{ duration: 0 }}>
    <Tabs defaultValue="play">
      <Tabs.List grow><Tabs.Tab value="play">How to Play</Tabs.Tab><Tabs.Tab value="scoring">Scoring</Tabs.Tab><Tabs.Tab value="hands">Hands</Tabs.Tab><Tabs.Tab value="enhancements">Enhancements</Tabs.Tab><Tabs.Tab value="flames">Flames</Tabs.Tab><Tabs.Tab value="bosses">Bosses</Tabs.Tab><Tabs.Tab value="shop">Shop</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="play" pt="md"><Stack gap="xs">
        <RuleSection title="PLAY HANDS">Choose a hand, select the dice that score, and Play.</RuleSection>
        <RuleSection title="CLEAR THE GOAL">Reach the Goal before you run out of playable hands and Rerolls.</RuleSection>
        <RuleSection title="REROLLS">You get {CONFIG.manualRerollsPerRound} Rerolls each Round. Each die rerolled costs one.</RuleSection>
        <RuleSection title="LIVES">Busting costs a Life and sends you back to the Shop. Lose all {CONFIG.maxLives} Lives and the run ends.</RuleSection>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="scoring" pt="md"><Stack gap="xs">
        <Title order={3}>Pips × Mult × XMult = Score</Title>
        <Text size="sm">Pips come from the hand and scoring dice.</Text>
        <Text size="sm">Mult comes from the hand.</Text>
        <Text size="sm">XMult comes from effects such as Flames.</Text>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="hands" pt="md"><Stack gap="md">
        <div><Title order={4}>UPPER HANDS</Title><Text size="sm">Upper hands score any number of matching Faces.</Text>
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs" mt="xs">{UPPER_HAND_IDS.map(hand => <div key={hand} className="help-item"><Text size="sm" fw={700}>{HANDS[hand].name}</Text></div>)}</SimpleGrid></div>
        <div><Title order={4}>LOWER HANDS</Title><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="xs">{LOWER_HAND_IDS.map(hand => <div key={hand} className="help-item">
          <Text size="sm" fw={700}>{HANDS[hand].name}</Text><Text size="xs" c="dimmed">{LOWER_HAND_RULES[hand]}</Text>
        </div>)}</SimpleGrid></div>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="enhancements" pt="md"><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{ENHANCEMENT_IDS.map(id => <div key={id} className="help-item">
        <Text size="sm" fw={700}>{ENHANCEMENTS[id].name}</Text><Text size="xs" c="dimmed">{ENHANCEMENTS[id].description}</Text>
      </div>)}</SimpleGrid></Tabs.Panel>
      <Tabs.Panel value="flames" pt="md"><Stack gap="sm">
        <Text size="sm">Flames begin as Embers. Stoke them in the Shop; at 100 Gold, an Ember becomes a Bonfire and works globally.</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{FLAME_IDS.map(id => <div key={id} className="help-item">
          <Text size="sm" fw={700}>🔥 {FLAMES[id].name}</Text><Text size="xs" c="dimmed">{FLAMES[id].description}</Text>
          {(id === 'charge' || id === 'personalTrainer') && <Text size="xs" c="orange">Bonfire: {FLAMES[id].bonfireDescription}</Text>}
        </div>)}</SimpleGrid>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="bosses" pt="md"><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{BOSS_TYPES.map(id => <div key={id} className="help-item">
        <Text size="sm" fw={700}>{BOSSES[id].name}</Text><Text size="xs" c="dimmed">{BOSSES[id].shortRule}</Text>
      </div>)}</SimpleGrid></Tabs.Panel>
      <Tabs.Panel value="shop" pt="md"><Text size="sm">Spend Gold between Rounds to train hands, buy Enhancements, Stoke Flames, reroll offers, and restore Lives.</Text></Tabs.Panel>
    </Tabs>
  </Modal>;
}
