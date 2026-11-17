import { ActionIcon, Badge, Box, Button, Divider, Drawer, Group, Progress, SegmentedControl, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Board, FlameInstance, GameEvent } from '../game/types';
import { flameInstances, FLAMES, FLAME_SLOT_COUNT } from '../game/flames';
import type { PlaybackSpeed } from '../useGame';
import type { DiceDisplay } from '../uiSettings';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import { activeSpecialOfferStatusItems } from '../game/specialOffers';
import { chapterPosition } from '../game/chapters';
import type { FlameDetailsTarget } from './FlameDetailsModal';
import { infernoRoman } from '../game/engulfment';
import { exactRatioNumber } from '../game/scoreMath';
import { CurrencyAmount, type Currency } from './CurrencyAmount';
import { withSpeedDemonDecisionTime, type FlamePresentation } from '../game/flamePresentation';
import type { DecisionTimer } from '../game/decisionTimer';
import { useCurrencyPresentation, usePendingSpendPresentation } from './CurrencyTransfers';

const CONTEXTUAL_FLAME_TYPES = new Set<string>([
  'burnItDown', 'greaseTheEngine', 'lightningStrike', 'dareDevil', 'allIn', 'bribery',
]);

function HudStat({ testId, currency, label, value, accessibleValue = value }: { testId: string; currency: Currency; label: string; value: number; accessibleValue?: number }) {
  const formatted = formatPlayerNumber(accessibleValue);
  return <div className="hud-stat" data-testid={testId} aria-label={`${label} ${formatted}`}>
    <span className="hud-stat-label">{label}</span>
    <strong><CurrencyAmount currency={currency} value={value} accessible={false} /></strong>
  </div>;
}

function CurrencyHudStat({ currency, label, committed }: { currency: 'gold' | 'temper'; label: string; committed: number }) {
  const presented = useCurrencyPresentation(currency, committed);
  return <HudStat testId={`stat-${currency}`} currency={currency} label={label} value={presented} accessibleValue={committed} />;
}

interface FlameBadgeProps {
  flame: FlameInstance;
  presentation?: FlamePresentation;
  resolved: { text: string; eventId: number } | null;
  openFlameDetails: (target: FlameDetailsTarget) => void;
}

function FlameBadgeView({ flame, presentation, resolved, openFlameDetails }: FlameBadgeProps) {
  const state = presentation?.state ?? 'normal';
  return <span className="flame-badge-wrap" style={{ '--flame-progress': presentation?.progress ?? 0 } as CSSProperties}>
    <Badge component="button" type="button" data-testid={`active-flame-${flame.instanceId}`}
      data-flame-state={state} data-flame-progress={presentation?.progress} size="xs"
      color={flame.stage === 'bonfire' ? 'red' : 'orange'} variant="light"
      className={`flame-detail-trigger flame-state-${state}`}
      aria-label={`View ${FLAMES[flame.type].name} ${flame.stage} details. ${presentation?.accessibleLabel ?? 'Normal'}`}
      onClick={() => openFlameDetails({ flameInstanceId: flame.instanceId, kind: flame.stage })}>
      <span>🔥 {FLAMES[flame.type].shortName}</span>
      {presentation?.statusText && !CONTEXTUAL_FLAME_TYPES.has(flame.type)
        && <span className="flame-badge-status">{presentation.statusText}</span>}
    </Badge>
    {resolved && <span key={`${resolved.eventId}:${flame.instanceId}`} className="resolution-pop flame-resolution-pop"
      role="status" aria-live="polite">{resolved.text}</span>}
  </span>;
}

/** Owns the frequent visual clock update so it cannot invalidate TopHud or RoundScreen. */
function SpeedDemonFlameBadge({ flame, presentation, resolved, openFlameDetails, decisionTimer, decisionId }:
  FlameBadgeProps & { decisionTimer: DecisionTimer; decisionId: number }) {
  const [decisionMs, setDecisionMs] = useState(() => decisionTimer.elapsed(performance.now()));
  useEffect(() => {
    const update = () => setDecisionMs(decisionTimer.elapsed(performance.now()));
    const frame = window.requestAnimationFrame(update);
    const interval = window.setInterval(update, 50);
    return () => { window.cancelAnimationFrame(frame); window.clearInterval(interval); };
  }, [decisionTimer, decisionId]);
  const base = presentation ?? { instanceId: flame.instanceId, flame: flame.type, state: 'normal',
    accessibleLabel: `${FLAMES.speedDemon.name}: normal` };
  return <FlameBadgeView flame={flame}
    presentation={withSpeedDemonDecisionTime(base, flame.investedGold, decisionMs)}
    resolved={resolved} openFlameDetails={openFlameDetails} />;
}

export function TopHud({ board: resolvedBoard, event, flamePresentation = [], decisionTimer, speed, setSpeed, diceDisplay, setDiceDisplay, openRunInfo, openHelp, openRestoreLives, openFlameDetails, returnToTitle, onMenuOpenChange }: {
  board: Board;
  event?: GameEvent | null;
  flamePresentation?: FlamePresentation[];
  decisionTimer?: DecisionTimer;
  speed: PlaybackSpeed;
  setSpeed: (speed: PlaybackSpeed) => void;
  diceDisplay: DiceDisplay;
  setDiceDisplay: (display: DiceDisplay) => void;
  openRunInfo: () => void;
  openHelp: () => void;
  openRestoreLives: () => void;
  openFlameDetails: (target: FlameDetailsTarget) => void;
  returnToTitle: () => void;
  onMenuOpenChange?: (opened: boolean) => void;
}) {
  const pendingSpend = usePendingSpendPresentation();
  const board = pendingSpend?.actionType === 'RESTORE_LIFE' ? pendingSpend.before : resolvedBoard;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const maxLives = board.infernoRewards.upgrades.maxLives;
  const hearts = Array.from({ length: maxLives }, (_, index) => index < board.lives ? '♥' : '♡').join(' ');
  const specialOfferStatuses = activeSpecialOfferStatusItems(board.specialOfferEffects);
  const chapter = chapterPosition(board.round);
  const presentationByInstance = new Map(flamePresentation.map(item => [item.instanceId, item]));
  function resolvedContribution(instanceId: number, flameType: import('../game/types').Flame): { text: string; eventId: number } | null {
    if (!event) return null;
    const xFactor = event.type === 'HAND_SCORE_FINALIZED'
      ? event.handScore?.xMultFactors.find(factor => factor.flameInstanceId === instanceId) : undefined;
    if (xFactor && xFactor.value > 1) return { text: `×${formatPlayerNumber(xFactor.value)} XMULT`, eventId: event.id };
    const factor = event.type === 'CHARGE_CHANGED' && event.flame === flameType
      ? event.flameDiagnostics?.chargeFactorApplied ?? 1 : 1;
    return factor > 1 ? { text: `×${formatPlayerNumber(factor)} CHARGE`, eventId: event.id } : null;
  }
  function launch(action: () => void) {
    setDrawerOpen(false);
    onMenuOpenChange?.(false);
    action();
  }
  function setMenu(opened: boolean) {
    setDrawerOpen(opened);
    onMenuOpenChange?.(opened);
  }
  return <>
  <Box component="header" className="top-hud">
    <Group className="top-hud-row" justify="space-between" wrap="nowrap">
      <Text className="game-title">ROLL CALL</Text>
      <Group className="hud-stats" gap="xs" wrap="nowrap">
        <div className="hud-stat hud-stage" data-testid="stat-round"
          aria-label={board.runMode === 'scenario' ? `Scenario Round ${formatPlayerNumber(board.round)}`
            : `Chapter ${formatPlayerNumber(chapter.chapterNumber)}, Round ${formatPlayerNumber(chapter.chapterRound)}`}>
          <strong className="hud-stage-value">
            {board.runMode === 'scenario' ? <><span className="hud-stage-segment"><span className="hud-stage-letter">S</span></span>{' '}
              <span className="hud-stage-segment"><span className="hud-stage-letter">R</span>{formatPlayerNumber(board.round)}</span></>
              : <><span className="hud-stage-segment"><span className="hud-stage-letter">C</span>{formatPlayerNumber(chapter.chapterNumber)}</span>{' '}
                <span className="hud-stage-segment"><span className="hud-stage-letter">R</span>{formatPlayerNumber(chapter.chapterRound)}</span></>}
          </strong>
        </div>
        <CurrencyHudStat currency="gold" label="Gold" committed={board.gold} />
        <CurrencyHudStat currency="temper" label="Temper" committed={board.temper} />
        {board.phase === 'shop'
          ? <Tooltip label="Restore lost lives" withArrow><UnstyledButton className="hud-lives interactive" data-testid="stat-lives"
            data-tutorial="lives"
            aria-label={`${board.lives} of ${maxLives} lives; restore lives`} onClick={openRestoreLives}>{hearts}</UnstyledButton></Tooltip>
          : <div className="hud-lives" data-testid="stat-lives" data-tutorial="lives" aria-label={`${board.lives} of ${maxLives} lives`}>{hearts}</div>}
      </Group>
      <ActionIcon className="menu-trigger" variant="subtle" color="gray" size="lg" aria-label="Open menu" onClick={() => setMenu(true)}>
        <span aria-hidden="true" className="hamburger-icon"><i /><i /><i /></span>
      </ActionIcon>
    </Group>
    {board.phase === 'round' && <Progress data-testid="round-goal-progress"
      value={board.target > 0n ? Math.min(100, exactRatioNumber(board.score, board.target) * 100) : 0} size={4} radius={0}
      aria-label="Round Goal progress" aria-valuetext={`${formatExactScore(board.score)} of ${formatExactScore(board.target)} points toward the Goal`} />}
    {(board.flameSlots.some(Boolean) || board.phase === 'flameSelection') && <Group gap={4} px="xs" py={3} className="bonfire-strip" data-tutorial="flames"
      data-testid="flames-strip" aria-label={`${flameInstances(board).length} of ${FLAME_SLOT_COUNT} Flames owned`}>
      <Text size="xs" fw={700} c="orange">FLAMES · {flameInstances(board).length}/{FLAME_SLOT_COUNT}</Text>{board.flameSlots.flatMap(flame => {
        if (!flame) return [];
        const presentation = presentationByInstance.get(flame.instanceId);
        const state = presentation?.state ?? 'normal';
        const resolved = resolvedContribution(flame.instanceId, flame.type);
        if (flame.type === 'speedDemon' && board.phase === 'round' && decisionTimer) return [<SpeedDemonFlameBadge
          key={flame.instanceId} flame={flame} presentation={presentation} resolved={resolved}
          openFlameDetails={openFlameDetails} decisionTimer={decisionTimer} decisionId={board.decisionId} />];
        return [<span className="flame-badge-wrap" key={flame.instanceId}
          style={{ '--flame-progress': presentation?.progress ?? 0 } as CSSProperties}>
          <Badge component="button" type="button" data-testid={`active-flame-${flame.instanceId}`}
            data-flame-state={state} data-flame-progress={presentation?.progress} size="xs"
            color={flame.stage === 'bonfire' ? 'red' : 'orange'} variant="light"
            className={`flame-detail-trigger flame-state-${state}`}
            aria-label={`View ${FLAMES[flame.type].name} ${flame.stage} details. ${presentation?.accessibleLabel ?? 'Normal'}`}
            onClick={() => openFlameDetails({ flameInstanceId: flame.instanceId, kind: flame.stage })}>
            <span>🔥 {FLAMES[flame.type].shortName}</span>
            {presentation?.statusText && !CONTEXTUAL_FLAME_TYPES.has(flame.type)
              && <span className="flame-badge-status">{presentation.statusText}</span>}
          </Badge>
          {resolved && <span key={`${resolved.eventId}:${flame.instanceId}`} className="resolution-pop flame-resolution-pop"
            role="status" aria-live="polite">{resolved.text}</span>}
        </span>];
      })}
    </Group>}
    {board.engulfmentLevel > 0 && <Group gap="xs" px="xs" py={3}
      className="inferno-strip" aria-label="Inferno status">
      {board.engulfmentLevel > 0 && <Text size="xs" fw={900} c="red">INFERNO {infernoRoman(board.engulfmentLevel)} · ×{formatExactScore(board.infernoMultiplier)}</Text>}
    </Group>}
    {specialOfferStatuses.length > 0 && <Group gap={4} px="xs" py={3} wrap="nowrap" className="special-effects-strip" data-tutorial="special-offer-status"
      aria-label="Active Special Offers" data-testid="special-effects-status">
      <Text className="special-effects-heading" size="xs" fw={700}>SPECIAL EFFECTS</Text>
      <div className="special-effects-badges">{specialOfferStatuses.map(status => <Tooltip key={status.type}
        label={status.description} multiline maw={320} withArrow events={{ hover: true, focus: true, touch: true }}>
        <Badge component="button" type="button" tabIndex={0} size="xs" color="teal" variant="light"
          className="special-effect-badge" data-testid={`special-effect-${status.type}`}
          aria-label={`${status.label}. ${status.description}`}>{status.label}</Badge>
      </Tooltip>)}</div>
    </Group>}
  </Box>
  <Drawer opened={drawerOpen} onClose={() => setMenu(false)} position="right" size={320} title="Menu"
    transitionProps={{ duration: 0 }} classNames={{ content: 'game-menu-drawer', header: 'game-menu-header' }}>
    <Stack gap="md">
      <div><Text size="xs" fw={800} tt="uppercase" mb={6}>Game speed</Text>
        <SegmentedControl fullWidth aria-label="Playback speed" value={speed}
          onChange={value => setSpeed(value as PlaybackSpeed)}
          data={[{ label: 'NORMAL', value: 'normal' }, { label: 'FAST', value: 'fast' }, { label: 'INSTANT', value: 'instant' }]} />
      </div>
      <div><Text size="xs" fw={800} tt="uppercase" mb={6}>Dice display</Text>
        <SegmentedControl fullWidth aria-label="Dice display" value={diceDisplay}
          onChange={value => setDiceDisplay(value as DiceDisplay)}
          data={[{ label: 'NUMERALS', value: 'numerals' }, { label: 'PIPS', value: 'pips' }]} />
      </div>
      <Divider />
      <Button variant="default" fullWidth onClick={() => launch(openRunInfo)}>Run Info</Button>
      <Button variant="default" fullWidth onClick={() => launch(openHelp)}>How to Play</Button>
      <Button variant="subtle" color="gray" fullWidth onClick={() => launch(returnToTitle)}>Return to Title</Button>
    </Stack>
  </Drawer>
  </>;
}
