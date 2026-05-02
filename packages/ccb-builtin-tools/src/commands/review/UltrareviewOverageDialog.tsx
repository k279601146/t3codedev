import React, { useCallback, useRef, useState } from 'react';
import { Select } from "@t3tools/ccb-engine/src/components/CustomSelect/select.ts";
import { Box, Dialog, Text } from '@anthropic/ink';

type Props = {
  onProceed: (signal: AbortSignal) => Promise<void>;
  onCancel: () => void;
};

export function UltrareviewOverageDialog({ onProceed, onCancel }: Props): React.ReactNode {
  const [isLaunching, setIsLaunching] = useState(false);
  const abortControllerRef = useRef(new AbortController());

  const handleSelect = useCallback(
    (value: string) => {
      if (value === 'proceed') {
        setIsLaunching(true);
        // If onProceed rejects (e.g. launchRemoteReview throws), onDone is
        // never called and the dialog stays mounted â€?restore the Select so
        // the user can retry or cancel instead of staring at "Launchingâ€?.
        void onProceed(abortControllerRef.current.signal).catch(() => setIsLaunching(false));
      } else {
        onCancel();
      }
    },
    [onProceed, onCancel],
  );

  // Escape during launch aborts the in-flight onProceed via signal so the
  // caller can skip side effects (confirmOverage, onDone) â€?otherwise a
  // fire-and-forget launch would keep running and bill despite "cancelled".
  const handleCancel = useCallback(() => {
    abortControllerRef.current.abort();
    onCancel();
  }, [onCancel]);

  const options = [
    { label: 'Proceed with Extra Usage billing', value: 'proceed' },
    { label: 'Cancel', value: 'cancel' },
  ];

  return (
    <Dialog title="Ultrareview billing" onCancel={handleCancel} color="background">
      <Box flexDirection="column" gap={1}>
        <Text>
          Your free ultrareviews for this organization are used. Further reviews bill as Extra Usage (pay-per-use).
        </Text>
        {isLaunching ? (
          <Text color="background">Launchingâ€?/Text>
        ) : (
          <Select options={options} onChange={handleSelect} onCancel={handleCancel} />
        )}
      </Box>
    </Dialog>
  );
}

