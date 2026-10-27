import { MantineProvider } from '@mantine/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScenarioBrowser } from './ScenarioBrowser';
import { ScenarioDetails } from './ScenarioDetails';
import { emptyScenarioProgress } from '../game/scenarioProgress';
import { scenarioById } from '../game/scenarios';

describe('Scenario presentation', () => {
  it('renders all cards and communicates completion with text and a check mark', () => {
    const progress = emptyScenarioProgress();
    progress.completions['popcorn'] = { scenarioId: 'popcorn', scenarioVersion: 1, completed: true,
      firstCompletedAt: '2026-01-01T00:00:00.000Z', completionCount: 1, completedRunIds: ['run'] };
    const html = renderToStaticMarkup(<MantineProvider><ScenarioBrowser progress={progress} onOpen={() => {}} onBack={() => {}} /></MantineProvider>);
    expect((html.match(/data-testid="scenario-card-/g) ?? [])).toHaveLength(6);
    expect(html).toContain('✓ COMPLETED');
    expect(html).toContain('One die. Six numbers. Count it down.');
  });

  it('keeps a multi-effect starting die as one inspectable die and shows authoritative loadout data', () => {
    const html = renderToStaticMarkup(<MantineProvider><ScenarioDetails scenario={scenarioById('popcorn')!}
      completed={false} onBack={() => {}} onStart={() => {}} /></MantineProvider>);
    expect((html.match(/class="scenario-loadout-die"/g) ?? [])).toHaveLength(5);
    expect(html).toContain('Jumping Bean');
    expect(html).toContain('Chameleon');
    expect(html).toContain('Weighted');
    expect(html).toContain('Reach Engulfment');
    expect(html).toContain('×');
    expect(html).toContain('MULT');
  });
});
