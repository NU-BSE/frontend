import { serverBaseUrl } from './runtimeConfig';
import { userHeaders } from './userSession';

type PasskeyModule = {
  create?: (requestJson: string) => Promise<unknown>;
  get?: (requestJson: string) => Promise<unknown>;
  createCredential?: (requestJson: string) => Promise<unknown>;
  getCredential?: (requestJson: string) => Promise<unknown>;
};

const optionalRequire = <T>(name: string): T | undefined => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name) as T;
  } catch {
    return undefined;
  }
};

const passkey = (): PasskeyModule => {
  const module = optionalRequire<PasskeyModule>('react-native-passkey');
  if (!module) {
    throw new Error('react-native-passkey is unavailable');
  }
  return module;
};

export const requestWebAuthnChallenge = async (input: {
  payloadHash: string;
  nonce: string;
}): Promise<{
  challengeId: string;
  options: unknown;
  mode: 'registration' | 'authentication';
}> => {
  const response = await fetch(`${serverBaseUrl}/attest/webauthn/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...userHeaders() },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`WebAuthn challenge failed with HTTP ${response.status}`);
  }
  return (await response.json()) as {
    challengeId: string;
    options: unknown;
    mode: 'registration' | 'authentication';
  };
};

export const performWebAuthnCeremony = async (input: {
  payloadHash: string;
  nonce: string;
}): Promise<{ challengeId: string; response: unknown }> => {
  const challenge = await requestWebAuthnChallenge(input);
  const module = passkey();
  const requestJson = JSON.stringify(challenge.options);
  const fn =
    challenge.mode === 'registration'
      ? module.create ?? module.createCredential
      : module.get ?? module.getCredential;
  if (!fn) {
    throw new Error('react-native-passkey does not expose the required method');
  }
  const credentialResponse = await fn(requestJson);
  const verifyResponse = await fetch(
    `${serverBaseUrl}/attest/webauthn/verify`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...userHeaders() },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        response: credentialResponse,
      }),
    },
  );
  if (!verifyResponse.ok) {
    throw new Error(`WebAuthn verification failed with HTTP ${verifyResponse.status}`);
  }

  return {
    challengeId: challenge.challengeId,
    response: await verifyResponse.json(),
  };
};
