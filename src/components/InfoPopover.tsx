import { ActionIcon, Popover, Text } from '@mantine/core';
import { useState } from 'react';

export function InfoCircleIcon() {
  return <svg className="info-circle-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 10.5v6" />
    <circle className="info-circle-dot" cx="12" cy="7.5" r="1" />
  </svg>;
}

export function InfoPopover({ label, description }: { label: string; description: string }) {
  const [opened, setOpened] = useState(false);
  return <Popover opened={opened} onChange={setOpened} position="bottom-end" width={260} shadow="md" withArrow withinPortal>
    <Popover.Target>
      <ActionIcon className="info-popover-trigger" size="sm" variant="subtle" color="gray" aria-label={`About ${label}`}
        aria-expanded={opened} onClick={event => { event.stopPropagation(); setOpened(value => !value); }}
        onKeyDown={event => { if (event.key === 'Escape' && opened) { event.stopPropagation(); setOpened(false); } }}>
        <InfoCircleIcon />
      </ActionIcon>
    </Popover.Target>
    <Popover.Dropdown role="tooltip"><Text size="xs">{description}</Text></Popover.Dropdown>
  </Popover>;
}
