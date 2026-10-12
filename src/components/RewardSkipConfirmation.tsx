import { Button, Group, Modal, Text } from '@mantine/core';
import { useRef, useState } from 'react';

export function RewardSkipConfirmation({ disabled, onConfirm }: {
  disabled: boolean;
  onConfirm: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const confirming = useRef(false);

  function close() {
    if (!confirming.current) setOpened(false);
  }

  function confirm() {
    if (disabled || confirming.current) return;
    confirming.current = true;
    setOpened(false);
    onConfirm();
  }

  return <>
    <Button variant="default" color="gray" disabled={disabled} onClick={() => setOpened(true)}>SKIP REWARD</Button>
    <Modal opened={opened} onClose={close} title="Skip this reward?" centered returnFocus transitionProps={{ duration: 0 }}>
      <Text>You haven&apos;t claimed a reward. Are you sure you want to continue without one?</Text>
      <Group justify="flex-end" mt="lg">
        <Button variant="default" data-autofocus onClick={() => setOpened(false)}>GO BACK</Button>
        <Button color="red" disabled={disabled} onClick={confirm}>SKIP REWARD</Button>
      </Group>
    </Modal>
  </>;
}
