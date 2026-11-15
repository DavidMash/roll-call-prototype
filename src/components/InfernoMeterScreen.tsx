import { Button, Stack, Text, Title } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { INFERNO_TIER_POWER_THRESHOLDS } from '../game/engulfment';
import { infernoMeterPosition } from '../game/infernoMeter';
import type { Action, Board } from '../game/types';
import { RunActionPortal } from './RunActionRow';

export const INFERNO_METER_AUTO_CONTINUE_MS = 5_000;
export const INFERNO_FLAME_ANIMATION_MS = 820;
export const INFERNO_DIE_ANIMATION_MS = 460;
const FLAME_HOLD_MS = 420;
const DICE_TEXT_DELAY_MS = FLAME_HOLD_MS + INFERNO_FLAME_ANIMATION_MS + 160;
const DICE_EXTENSION_DELAY_MS = DICE_TEXT_DELAY_MS + 360;

const heatStops = [
  { r: 151, g: 43, b: 24 }, { r: 221, g: 72, b: 25 }, { r: 255, g: 132, b: 28 },
  { r: 255, g: 190, b: 52 }, { r: 255, g: 226, b: 126 }, { r: 255, g: 250, b: 229 },
];

export function infernoHeatColor(power: number): string {
  const boundaries = [1, ...INFERNO_TIER_POWER_THRESHOLDS];
  let index = boundaries.findIndex(boundary => power < boundary) - 1;
  if (index < 0) index = boundaries.length - 2;
  index = Math.max(0, Math.min(heatStops.length - 1, index));
  const nextIndex = Math.min(heatStops.length - 1, index + 1);
  const start = boundaries[Math.min(index, boundaries.length - 2)];
  const end = boundaries[Math.min(index + 1, boundaries.length - 1)];
  const ratio = end > start ? Math.max(0, Math.min(1, (power - start) / (end - start))) : 1;
  const from = heatStops[index]; const to = heatStops[nextIndex];
  const channel = (key: 'r' | 'g' | 'b') => Math.round(from[key] + (to[key] - from[key]) * ratio);
  return `rgb(${channel('r')} ${channel('g')} ${channel('b')})`;
}

export const infernoMeterVisualWidth = (checkpointCount: number): number =>
  checkpointCount >= 6 ? 100 : checkpointCount >= 4 ? 86 : 72;

export function InfernoMeterScreen({ board, submit }: { board: Board; submit: (action: Action) => void }) {
  const meter = board.infernoMeter.current!;
  const reducedMotion = useReducedMotion();
  const [flameStarted, setFlameStarted] = useState(meter.dormant || reducedMotion);
  const [diceTextVisible, setDiceTextVisible] = useState(false);
  const [diceExtended, setDiceExtended] = useState(meter.dormant || reducedMotion);
  const [displayPower, setDisplayPower] = useState(meter.dormant || reducedMotion
    ? meter.displayedFlamePower : meter.startFlamePower);
  const [countdown, setCountdown] = useState(Math.ceil(INFERNO_METER_AUTO_CONTINUE_MS / 1000));
  const continued = useRef(false);
  const frameRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);

  const continueOnce = useCallback(() => {
    if (continued.current) return;
    continued.current = true;
    submit({ type: 'CONTINUE_INFERNO_METER' });
  }, [submit]);

  useEffect(() => {
    const deadline = performance.now() + INFERNO_METER_AUTO_CONTINUE_MS;
    const interval = window.setInterval(() => setCountdown(Math.max(1,
      Math.ceil((deadline - performance.now()) / 1000))), 100);
    const autoContinue = window.setTimeout(continueOnce, INFERNO_METER_AUTO_CONTINUE_MS);

    if (!meter.dormant && !reducedMotion) {
      const startAnimation = window.setTimeout(() => {
        setFlameStarted(true);
        const startedAt = performance.now();
        const startPower = meter.startFlamePower;
        const delta = meter.displayedFlamePower - startPower;
        const animate = (now: number) => {
          const elapsed = Math.min(1, (now - startedAt) / INFERNO_FLAME_ANIMATION_MS);
          const eased = 1 - Math.pow(1 - elapsed, 3);
          setDisplayPower(startPower + delta * eased);
          if (elapsed < 1) frameRef.current = window.requestAnimationFrame(animate);
          else frameRef.current = null;
        };
        frameRef.current = window.requestAnimationFrame(animate);
      }, FLAME_HOLD_MS);
      timeoutsRef.current.push(startAnimation);
      if (meter.dieFinalPower !== null) {
        timeoutsRef.current.push(window.setTimeout(() => setDiceTextVisible(true), DICE_TEXT_DELAY_MS));
        timeoutsRef.current.push(window.setTimeout(() => setDiceExtended(true), DICE_EXTENSION_DELAY_MS));
      }
    } else if (!meter.dormant) {
      setDisplayPower(meter.displayedFlamePower);
      setFlameStarted(true);
      if (meter.dieFinalPower !== null) { setDiceTextVisible(true); setDiceExtended(true); }
    }

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(autoContinue);
      for (const timeout of timeoutsRef.current) window.clearTimeout(timeout);
      timeoutsRef.current = [];
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [continueOnce, meter, reducedMotion]);

  const checkpointCount = flameStarted ? meter.checkpointCount : meter.startCheckpointCount;
  const scaleMaxPower = flameStarted ? meter.scaleMaxPower : meter.startScaleMaxPower;
  const flamePosition = infernoMeterPosition(displayPower, checkpointCount, scaleMaxPower);
  const dieWidth = meter.dieBasePower !== null && meter.dieFinalPower !== null
    ? Math.max(0, infernoMeterPosition(meter.dieFinalPower, checkpointCount, scaleMaxPower)
      - infernoMeterPosition(meter.dieBasePower, checkpointCount, scaleMaxPower)) : 0;
  const width = infernoMeterVisualWidth(checkpointCount);
  const message = meter.dormant
    ? `You rejected the last offer. The Inferno will return in ${meter.cooldownRounds} round${meter.cooldownRounds === 1 ? '' : 's'}.`
    : null;
  const style = {
    '--inferno-meter-width': `${width}%`,
    '--inferno-flame-position': `${flamePosition}%`,
    '--inferno-die-width': `${diceExtended ? dieWidth : 0}%`,
    '--inferno-flame-color': meter.dormant ? '#777b80' : infernoHeatColor(displayPower),
    '--inferno-flame-duration': reducedMotion ? '0ms' : `${INFERNO_FLAME_ANIMATION_MS}ms`,
    '--inferno-die-duration': reducedMotion ? '0ms' : `${INFERNO_DIE_ANIMATION_MS}ms`,
  } as CSSProperties;

  return <section className={`inferno-meter-screen ${meter.dormant ? 'is-dormant' : ''}`}
    data-testid="inferno-meter-screen" data-dormant={meter.dormant ? 'true' : 'false'}
    data-actual-power={meter.actualFlamePower} data-checkpoint-count={meter.checkpointCount}
    aria-labelledby="inferno-meter-title" style={style}>
    <Stack align="center" gap="md" className="inferno-meter-content">
      <div className="inferno-meter-heading">
        <Title order={1} id="inferno-meter-title">THE INFERNO</Title>
        <Text>Utilize your Flames to impress The Inferno.</Text>
      </div>
      <div className="inferno-meter-stage-copy" aria-live="polite">
        {message ? <Text fw={800}>{message}</Text> : <>
          <Text className={`inferno-flame-stage-text ${flameStarted ? 'is-fading' : ''}`}>
            You seem to be getting this much out of your Flames{'\u2026'}
          </Text>
          {meter.dieFinalPower !== null && <Text className={`inferno-dice-stage-text ${diceTextVisible ? 'is-visible' : ''}`}>
            {'\u2026'}and you have a powerful die.
          </Text>}
        </>}
      </div>
      <div className="inferno-meter-shell" data-testid="inferno-meter-shell">
        <div className="inferno-meter-track" role="img"
          aria-label={`Perceived Flame power ${displayPower.toFixed(1)}${meter.dieFinalPower !== null ? ', with a qualifying die contribution' : ''}`}>
          <div className="inferno-meter-flame-fill" data-testid="inferno-flame-fill" />
          <div className="inferno-meter-dice-fill" data-testid={meter.dieFinalPower !== null ? 'inferno-dice-contribution' : undefined} />
          {INFERNO_TIER_POWER_THRESHOLDS.slice(0, meter.checkpointCount).map((threshold, index) => {
            const position = infernoMeterPosition(threshold, checkpointCount, scaleMaxPower);
            return <span key={threshold} className={`inferno-meter-checkpoint ${index >= meter.startCheckpointCount && !flameStarted ? 'is-pending' : ''}`}
              data-testid="inferno-checkpoint" data-threshold={threshold} style={{ left: `${position}%` }} aria-hidden="true" />;
          })}
          <span className="inferno-power-label" data-testid="inferno-power-label"
            style={{ left: `${flamePosition}%` }}>{'\u00d7'}{displayPower.toFixed(1)}</span>
        </div>
      </div>
      <Text className="visually-hidden" aria-live="polite">Current perceived Flame power is {displayPower.toFixed(1)}.</Text>
    </Stack>
    <RunActionPortal><div className="run-action-primary"><div className="map-continue inferno-meter-continue"
      style={{ '--map-auto-continue-duration': `${INFERNO_METER_AUTO_CONTINUE_MS}ms` } as CSSProperties}>
      <span className="map-continue-fill" aria-hidden="true" />
      <Button size="sm" variant="transparent" className="map-continue-button" onClick={continueOnce}
        aria-label="Continue" title={`Automatically continues in ${countdown} second${countdown === 1 ? '' : 's'}`}>
        <span>CONTINUE</span><span className="map-continue-countdown" data-testid="inferno-meter-countdown" aria-hidden="true">{countdown}</span>
      </Button>
    </div></div></RunActionPortal>
  </section>;
}
