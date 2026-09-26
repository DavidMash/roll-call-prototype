import { ActionIcon, Popover, Text } from '@mantine/core';
import { useState } from 'react';

export function InfoPopover({ label, description }: { label: string; description: string }) {
  const [opened, setOpened] = useState(false);
  return <Popover opened={opened} onChange={setOpened} position="bottom-end" width={260} shadow="md" withArrow withinPortal>
    <Popover.Target>
      <ActionIcon size="sm" variant="subtle" color="gray" aria-label={`About ${label}`}
        aria-expanded={opened} onClick={event => { event.stopPropagation(); setOpened(value => !value); }}>
        <span aria-hidden="true">i</span>
      </ActionIcon>
    </Popover.Target>
    <Popover.Dropdown role="tooltip"><Text size="xs">{description}</Text></Popover.Dropdown>
  </Popover>;
}
