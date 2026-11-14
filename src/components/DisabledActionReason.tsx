import { ActionIcon, Tooltip } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

export function DisabledActionReason({ action, reason, testId }: {
  action: string;
  reason: string;
  testId?: string;
}) {
  return <Tooltip label={reason} multiline maw={280} withArrow
    events={{ hover: true, focus: true, touch: true }}>
    <ActionIcon className="disabled-action-reason" variant="subtle" color="gray" size={44}
      aria-label={`${action} unavailable: ${reason}`} data-testid={testId}>
      <IconInfoCircle size={17} aria-hidden="true" />
    </ActionIcon>
  </Tooltip>;
}
