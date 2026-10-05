import { useEffect, useMemo, useRef } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { TutorialBeat, TutorialSession } from './types';
import { activeTutorialBeat } from './tutorialSteps';

function descriptionHtml(beat: TutorialBeat): string {
  const paragraphs = beat.body.map(line => `<p>${line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`).join('');
  return `${paragraphs}${beat.requiredAction ? `<p class="tutorial-required-copy"><strong>${beat.requiredAction}</strong></p>` : ''}`;
}

export function TutorialDirector({ session, paused, onAcknowledge, onFinish }: {
  session: TutorialSession;
  paused: boolean;
  onAcknowledge: (beatId: string) => void;
  onFinish: () => void;
}) {
  const beat = useMemo(() => paused ? null : activeTutorialBeat(session), [paused, session]);
  const instance = useRef<Driver | null>(null);
  const acknowledged = useRef(onAcknowledge);
  const finish = useRef(onFinish);
  acknowledged.current = onAcknowledge;
  finish.current = onFinish;

  useEffect(() => {
    instance.current?.destroy();
    instance.current = null;
    document.body.classList.toggle('tutorial-required-action', !!beat && !beat.blocking);
    if (!beat) return () => document.body.classList.remove('tutorial-required-action');

    let cancelled = false;
    let timeout = 0;
    const show = (attempt = 0) => {
      if (cancelled) return;
      const target = beat.target ? document.querySelector<HTMLElement>(beat.target) : null;
      if (beat.target && !target && attempt < 8) {
        timeout = window.setTimeout(() => show(attempt + 1), 60);
        return;
      }
      const finishBeat = () => beat.id === 'tutorial-run-over' ? finish.current() : acknowledged.current(beat.id);
      const control = driver({
        animate: true,
        allowClose: false,
        overlayOpacity: beat.blocking ? 0.72 : 0.42,
        stagePadding: 7,
        stageRadius: 9,
        popoverOffset: 12,
        popoverClass: 'roll-call-tutorial-popover',
        disableActiveInteraction: beat.blocking,
        showProgress: false,
        showButtons: beat.blocking ? ['next'] : [],
        nextBtnText: beat.actionLabel ?? 'GOT IT',
        onNextClick: finishBeat,
      });
      instance.current = control;
      control.highlight({
        ...(target ? { element: target } : {}),
        popover: {
          title: beat.title,
          description: descriptionHtml(beat),
          side: beat.side ?? 'bottom',
          align: 'center',
          showButtons: beat.blocking ? ['next'] : [],
          nextBtnText: beat.actionLabel ?? 'GOT IT',
          onNextClick: finishBeat,
        },
      });
      window.setTimeout(() => {
        const popover = document.querySelector<HTMLElement>('.driver-popover');
        if (!beat.blocking) {
          document.querySelector<SVGElement>('.driver-overlay')?.style.setProperty('pointer-events', 'none', 'important');
          popover?.style.setProperty('pointer-events', 'none', 'important');
        }
        popover?.setAttribute('role', 'dialog');
        popover?.setAttribute('aria-modal', beat.blocking ? 'true' : 'false');
        popover?.setAttribute('aria-label', beat.title ?? 'Tutorial');
        popover?.querySelector<HTMLElement>('button')?.focus();
      }, 0);
    };
    show();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      instance.current?.destroy();
      instance.current = null;
      document.body.classList.remove('tutorial-required-action');
    };
  }, [beat?.id, beat?.body.join('|'), beat?.target, beat?.blocking]);

  return <div className="sr-only" role="status" aria-live="assertive" data-testid="tutorial-announcer">
    {beat ? `${beat.title ?? 'Tutorial'}. ${beat.body.join(' ')} ${beat.requiredAction ?? ''}` : ''}
  </div>;
}
