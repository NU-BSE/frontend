import { useCallback, useState } from 'react';
import {
  AttestationFailure,
  executeAttested,
  type AttestationProgress,
} from '@attestation/client/executeAttested';
import { performWebAuthnCeremony } from '@attestation/client/webauthn';
import type { SensitiveAction } from '@attestation/shared/wire';

export type AttestedActionState =
  | 'idle'
  | AttestationProgress
  | 'done'
  | { error: AttestationFailure };

export const useAttestedAction = <TResult>(
  apiCall: (accessToken: string) => Promise<TResult>,
): {
  execute: (action: SensitiveAction) => Promise<TResult>;
  state: AttestedActionState;
} => {
  const [state, setState] = useState<AttestedActionState>('idle');

  const execute = useCallback(
    async (action: SensitiveAction): Promise<TResult> => {
      setState('probing');
      try {
        const run = (webauthn?: {
          challengeId: string;
          response: unknown;
        }) =>
          executeAttested(action, apiCall, {
            onProgress: setState,
            ...(webauthn ? { webauthn } : {}),
          });

        try {
          const result = await run();
          setState('done');
          return result;
        } catch (error) {
          if (
            error instanceof AttestationFailure &&
            error.code === 'REQUIRES_ELEVATION' &&
            error.requiredTier === 'HIGHEST'
          ) {
            setState('elevating');
            const result = await executeAttested(action, apiCall, {
              onProgress: setState,
              prepareWebAuthn: ({ nonce, bound }) =>
                performWebAuthnCeremony({
                  nonce,
                  payloadHash: bound.payloadHash,
                }),
            });
            setState('done');
            return result;
          }
          throw error;
        }
      } catch (error) {
        const failure =
          error instanceof AttestationFailure
            ? error
            : new AttestationFailure({
                code: 'UNKNOWN',
                message: error instanceof Error ? error.message : String(error),
                retryable: false,
              });
        setState({ error: failure });
        throw failure;
      }
    },
    [apiCall],
  );

  return { execute, state };
};
