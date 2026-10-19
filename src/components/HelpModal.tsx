import { Modal, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core';
import { CONFIG } from '../game/config';
import { dieEffectDescription } from '../game/diceEconomy';
import { FLAMES, FLAME_IDS, isChargeFlame } from '../game/flames';
import { HANDS, LOWER_HAND_IDS, UPPER_HAND_IDS } from '../game/hands';
import { BOSSES, BOSS_TYPES, MINI_BOSS_TYPES } from '../game/bosses';
import type { HandId } from '../game/types';
import { SPECIAL_OFFERS, SPECIAL_OFFER_IDS } from '../game/specialOffers';
import { SPECIAL_DICE, SPECIAL_DIE_TYPES } from '../game/specialDice';
import { RarityBadge } from './RarityBadge';

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
      <Tabs.List grow><Tabs.Tab value="play">How to Play</Tabs.Tab><Tabs.Tab value="scoring">Scoring</Tabs.Tab><Tabs.Tab value="hands">Hands</Tabs.Tab><Tabs.Tab value="dice">Dice</Tabs.Tab><Tabs.Tab value="flames">Flames</Tabs.Tab><Tabs.Tab value="offers">Offers</Tabs.Tab><Tabs.Tab value="bosses">Bosses</Tabs.Tab><Tabs.Tab value="shop">Shop</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="play" pt="md"><Stack gap="xs">
        <RuleSection title="PLAY HANDS">Choose a hand, select the dice that score, and Play.</RuleSection>
        <RuleSection title="PLAY, FREE PLAY, SCORE">A Play commits a hand and rerolls its selected dice afterward. A Free Play does neither. Each die contribution is a Score and may activate its effect.</RuleSection>
        <RuleSection title="CLEAR THE GOAL">Reach the Goal before you run out of playable hands and Rerolls.</RuleSection>
        <RuleSection title="REROLLS">You get {CONFIG.manualRerollsPerRound} Rerolls each Round. Each die rerolled costs one.</RuleSection>
        <RuleSection title="LIVES">Busting costs a Life and sends you back to the Shop. Lose all {CONFIG.maxLives} Lives and the run ends.</RuleSection>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="offers" pt="md"><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{SPECIAL_OFFER_IDS.map(id => <div key={id} className="help-item">
        <Text size="sm" fw={700}>{SPECIAL_OFFERS[id].name} <RarityBadge rarity={SPECIAL_OFFERS[id].rarity} compact /></Text><Text size="xs" c="dimmed">{SPECIAL_OFFERS[id].description}</Text>
      </div>)}</SimpleGrid></Tabs.Panel>
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
      <Tabs.Panel value="dice" pt="md"><Stack gap="sm"><Text size="sm">Own collectible D6s with stable identity. Equip up to five in Roster order; Storage dice stay out of the Round. Buy, sell, move, and fuse identical special dice in the Dice Shop.</Text><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{SPECIAL_DIE_TYPES.filter(id => id !== 'normal').map(id => <div key={id} className="help-item" data-testid={`help-die-${id}`}>
        <Text size="sm" fw={700}>{SPECIAL_DICE[id].name} D6 <RarityBadge rarity={SPECIAL_DICE[id].rarity!} compact /></Text><Text size="xs" c="dimmed">{dieEffectDescription(id, 1)}</Text>
      </div>)}</SimpleGrid></Stack></Tabs.Panel>
      <Tabs.Panel value="flames" pt="md"><Stack gap="sm">
        <Text size="sm">You have five global Flame slots. Flames begin as Embers; Stoke one in Fire Keeping and it becomes a Bonfire at 100 Gold. A Flame's written condition is its complete activation condition.</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">{FLAME_IDS.map(id => <div key={id} className="help-item">
          <Text size="sm" fw={700}>🔥 {FLAMES[id].name} <RarityBadge rarity={FLAMES[id].rarity} compact /></Text><Text size="xs" c="dimmed">{FLAMES[id].description}</Text>
          {isChargeFlame(id) && <Text size="xs" c="orange">Bonfire: {FLAMES[id].bonfireDescription}</Text>}
        </div>)}</SimpleGrid>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="bosses" pt="md"><Stack gap="md">
        <div><Title order={4}>MINI-BOSSES</Title><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="xs">{MINI_BOSS_TYPES.map(id => <div key={id} className="help-item">
          <Text size="sm" fw={700}>{BOSSES[id].name}</Text><Text size="xs" c="dimmed">{BOSSES[id].shortRule}</Text>
        </div>)}</SimpleGrid></div>
        <div><Title order={4}>BOSSES</Title><SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="xs">{BOSS_TYPES.map(id => <div key={id} className="help-item">
          <Text size="sm" fw={700}>{BOSSES[id].name}</Text><Text size="xs" c="dimmed">{BOSSES[id].shortRule}</Text>
        </div>)}</SimpleGrid></div>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="shop" pt="md"><Stack gap="xs"><Text size="sm" fw={700}>DICE → TRAINING → FIRE KEEPING</Text>
        <Text size="sm">These are sections of one persistent Shop visit. Move backward freely without changing offers, purchases, Gold, or Training prices.</Text>
        <Text size="sm">Training lets you improve any hand. A hand becomes more expensive as it rises above the rest of its Upper or Lower section; catching up lower hands stays inexpensive.</Text>
      </Stack></Tabs.Panel>
    </Tabs>
  </Modal>;
}
