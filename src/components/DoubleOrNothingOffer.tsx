import { Button, Group, Paper, Progress, Stack, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import { FLAME_SCALING } from '../game/flames';
import { HANDS } from '../game/hands';
import type { Action, PendingDoubleOrNothingOffer } from '../game/types';

const OFFER_MS = FLAME_SCALING.doubleOrNothing.offerSeconds * 1000;

export function DoubleOrNothingOffer({ offer, submit }: {
  offer: PendingDoubleOrNothingOffer;
  submit: (action: Action) => void;
}) {
  const [remainingMs, setRemainingMs] = useState(OFFER_MS);
  const submitRef = useRef(submit);
  useEffect(() => { submitRef.current = submit; }, [submit]);

  useEffect(() => {
    const deadline = Date.now() + OFFER_MS;
    let expired = false;
    setRemainingMs(OFFER_MS);
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      setRemainingMs(remaining);
      if (remaining === 0 && !expired) {
        expired = true;
        submitRef.current({ type: 'DECLINE_DOUBLE_OR_NOTHING', reason: 'expired' });
      }
    };
    const interval = window.setInterval(tick, 50);
    return () => window.clearInterval(interval);
  }, [offer.packageId]);

  const seconds = Math.max(0, remainingMs / 1000);
  return <Paper withBorder p="xs" className="double-or-nothing-offer" data-testid="double-or-nothing-offer"
    role="status" aria-live="polite">
    <Stack gap={5}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Text fw={950} size="sm">DOUBLE OR NOTHING</Text>
        <Text fw={900} size="sm" className="double-or-nothing-countdown" data-testid="double-or-nothing-countdown">
          {seconds.toFixed(1)}s
        </Text>
      </Group>
      <Text size="sm">Give up <strong>{formatExactScore(offer.packageScore)} Score</strong>. Replay{' '}
        <strong>{HANDS[offer.hand].name}</strong> manually later for <strong>×{formatPlayerNumber(offer.factor)} XMult</strong>.</Text>
      <Progress value={remainingMs / OFFER_MS * 100} size="xs" color="orange" aria-hidden="true" />
      <Group justify="flex-end" gap="xs" wrap="nowrap">
        <Button size="compact-sm" variant="subtle" color="gray"
          onClick={() => submit({ type: 'DECLINE_DOUBLE_OR_NOTHING', reason: 'ignored' })}>KEEP SCORE</Button>
        <Button size="compact-sm" color="orange" onClick={() => submit({ type: 'ACCEPT_DOUBLE_OR_NOTHING' })}
          data-testid="accept-double-or-nothing">ACCEPT WAGER</Button>
      </Group>
    </Stack>
  </Paper>;
}
