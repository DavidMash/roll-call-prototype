import { Badge, Button, Group, Modal, Paper, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import {
  engulfmentAnimationProfile, engulfmentAssetKey, engulfmentHasQuestWarning, infernoMultiplier, infernoRoman, ownedEngulfmentAssets,
} from '../game/engulfment';
import { formatExactScore, formatPlayerNumber } from '../game/copy';
import { FLAMES } from '../game/flames';
import type { EngulfmentAttemptedEvent } from '../game/runHistoryV2';
import type { Action, EngulfmentAssetRef, GameState } from '../game/types';

type Stage = 'select' | 'warning' | 'ritual' | 'result';

function assetStatus(asset: EngulfmentAssetRef, state: GameState): string {
  if (asset.kind === 'ember') {
    const investment = state.dice.find(die => die.id === asset.dieId)?.flame?.investedGold ?? 0;
    return `EMBER · D${asset.dieId + 1} · ${formatPlayerNumber(investment)} / 100 Gold`;
  }
  return asset.kind === 'bonfire' ? 'BONFIRE' : 'WILDFIRE';
}

export function EngulfmentModal({ state, opened, result, onClose, submit }: {
  state: GameState;
  opened: boolean;
  result: EngulfmentAttemptedEvent | null;
  onClose: () => void;
  submit: (action: Action) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [stage, setStage] = useState<Stage>('select');
  const [committedVisitId, setCommittedVisitId] = useState<number | null>(null);
  const assets = useMemo(() => ownedEngulfmentAssets(state), [state.dice, state.bonfires, state.wildfires, state.flameInstanceIds]);
  const assetByKey = new Map(assets.map(asset => [engulfmentAssetKey(asset), asset]));
  const selectedAssets = selected.flatMap(key => assetByKey.get(key) ?? []);
  const hasUnfinishedQuest = engulfmentHasQuestWarning(state);
  const committedResult = result?.shopVisitId === committedVisitId ? result : null;
  const profile = committedResult ? engulfmentAnimationProfile(committedResult.offeringMultiplier) : null;

  useEffect(() => {
    if (!opened) { setSelected([]); setStage('select'); setCommittedVisitId(null); }
  }, [opened]);
  useEffect(() => {
    if (stage === 'select' || stage === 'warning') setSelected(current => current.filter(key => assetByKey.has(key)));
  }, [assets, stage]);
  useEffect(() => {
    if (stage !== 'ritual' || !committedResult || !profile) return;
    const timer = window.setTimeout(() => setStage('result'), profile.durationMs + 250);
    return () => window.clearTimeout(timer);
  }, [committedResult, profile?.durationMs, stage]);

  function commit() {
    const visitId = state.shop?.visitId;
    if (visitId === undefined) return;
    setCommittedVisitId(visitId);
    setStage('ritual');
    submit({ type: 'ATTEMPT_ENGULFMENT', assets: selectedAssets });
  }
  function attempt() {
    if (hasUnfinishedQuest) setStage('warning');
    else commit();
  }
  function toggle(asset: EngulfmentAssetRef) {
    const key = engulfmentAssetKey(asset);
    setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  }
  const current = infernoMultiplier(state.engulfmentLevel);
  const next = infernoMultiplier(state.engulfmentLevel + 1);
  const title = stage === 'warning' ? 'WARNING' : stage === 'result' && committedResult?.success
    ? 'ENGULFMENT' : stage === 'result' ? 'THE INFERNO REJECTS YOUR OFFERING' : 'ATTEMPT ENGULFMENT';

  return <Modal opened={opened} onClose={stage === 'select' || stage === 'warning' ? onClose : () => undefined}
    closeOnClickOutside={stage === 'select' || stage === 'warning'} closeOnEscape={stage === 'select' || stage === 'warning'}
    withCloseButton={stage === 'select' || stage === 'warning'} centered size="lg" title={title}
    classNames={{ content: `engulfment-modal${stage === 'result' && committedResult?.success ? ' is-success' : ''}` }}>
    {stage === 'select' && <Stack gap="md">
      <Text>Select one or more Flames to offer to the Inferno.</Text>
      <Text>The Inferno prefers Flames that have proven to be vital to your run.</Text>
      <Paper p="sm" className="engulfment-success-terms">
        <Text size="xs" fw={900} tt="uppercase">Upon success:</Text>
        <Text fw={900}>Inferno ×{formatExactScore(current)} → ×{formatExactScore(next)}</Text>
        <Text size="sm">Upper and Lower hands will be unified.</Text>
        <Text size="sm">Offered Flames will be snuffed out.</Text>
      </Paper>
      <div className="engulfment-assets" aria-label="Owned Flames">
        {assets.map(asset => {
          const key = engulfmentAssetKey(asset);
          const isSelected = selected.includes(key);
          return <UnstyledButton key={key} className={`engulfment-asset${isSelected ? ' is-selected' : ''}`}
            aria-pressed={isSelected} onClick={() => toggle(asset)}>
            <Group justify="space-between" wrap="nowrap">
              <div><Text fw={850}>{FLAMES[asset.flame].name}</Text><Text size="xs" c="dimmed">{assetStatus(asset, state)}</Text></div>
              <Badge color={isSelected ? 'red' : 'gray'} variant={isSelected ? 'filled' : 'light'}>{isSelected ? 'OFFERED' : 'SELECT'}</Badge>
            </Group>
          </UnstyledButton>;
        })}
      </div>
      <Text size="sm" c="dimmed">An insufficient offering costs nothing, but you only get one attempt this Shop.</Text>
      <Group justify="space-between"><Button variant="default" onClick={onClose}>BACK</Button>
        <Button color="red" disabled={selectedAssets.length === 0} onClick={attempt}>ATTEMPT ENGULFMENT</Button></Group>
    </Stack>}
    {stage === 'warning' && <Stack gap="lg">
      <Text>Your active quest will be forfeited if this Engulfment is successful.</Text>
      <Group justify="space-between"><Button variant="default" onClick={() => setStage('select')}>BACK</Button>
        <Button color="red" onClick={commit}>CONTINUE</Button></Group>
    </Stack>}
    {stage === 'ritual' && <Stack gap="lg" align="center" className={`engulfment-ritual strength-${profile?.strength ?? 'moderate'}`}>
      <div className="inferno-vessel" role="progressbar" aria-label="The Inferno tests the offering">
        <div className={`inferno-fill ${profile?.success ? 'is-success' : 'is-failure'}`}
          style={{ '--inferno-peak': `${profile?.peakPercent ?? 0}%`, '--inferno-duration': `${profile?.durationMs ?? 2000}ms` } as React.CSSProperties} />
      </div>
      <Text fw={850}>THE INFERNO STIRS</Text>
    </Stack>}
    {stage === 'result' && committedResult && (committedResult.success ? <Stack gap="md" align="center" className="engulfment-result-success">
      <Title order={2}>INFERNO {infernoRoman(committedResult.infernoLevelAfter)}</Title>
      <Text className="engulfment-new-multiplier">×{formatExactScore(committedResult.infernoMultiplierAfter)}</Text>
      <div className="snuffed-flames" aria-label="Snuffed Flames">{committedResult.flamesSnuffed.map(asset => <Badge
        className="snuffed-flame" key={engulfmentAssetKey(asset)} color="dark" variant="filled">{FLAMES[asset.flame].name} · SNUFFED</Badge>)}</div>
      <Text>Upper hands unified → Lv.{formatPlayerNumber(committedResult.upper.unifiedLevel)}</Text>
      <Text>Lower hands unified → Lv.{formatPlayerNumber(committedResult.lower.unifiedLevel)}</Text>
      <Button color="red" variant="white" onClick={onClose}>RETURN TO SHOP</Button>
    </Stack> : <Stack gap="md" align="center">
      <Text>Nothing was lost.</Text>
      <Button variant="default" onClick={onClose}>RETURN TO SHOP</Button>
    </Stack>)}
  </Modal>;
}
