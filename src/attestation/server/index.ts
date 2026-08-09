import express, { type Express } from 'express';
import Config from '../../../config/attestation.config';
import { createJwksRouter, resolveSigner } from './jitToken';
import { correlateLatency, createNonceRouter } from './nonceRoute';
import { createVerifyRouter } from './verify';
import {
  FidoMds3TrustProvider,
  StaticMdsTrustProvider,
  createWebAuthnRouter,
  type MdsTrustProvider,
} from './webauthn';
import { createTelegramAuthRouter } from './telegramAuth';
import { createAttestationResultRouter } from './attestationResult';
import { createAsnLookup, resolveVerifiers } from './defaults';
import { GoogleRevocationStatusProvider } from './hardwareFingerprint';
import { createStores } from './stores';
import { DecisionRecorder, createE2eHarnessRouter } from './e2eHarness';

const createMdsTrustProvider = (): {
  provider: MdsTrustProvider;
  note: string;
} => {
  if (Config.webauthn.mds3Url) {
    return {
      provider: new FidoMds3TrustProvider(Config.webauthn.mds3Url),
      note: `WebAuthn AAGUID trust: FIDO MDS3 feed ${Config.webauthn.mds3Url}`,
    };
  }
  return {
    provider: new StaticMdsTrustProvider(),
    note: 'WebAuthn AAGUID trust: static empty allow-list (no key can reach HIGHEST)',
  };
};

export type AttestationServer = {
  app: Express;
  /** What each pluggable dependency resolved to, for logging and /healthz. */
  notes: string[];
};

/**
 * Builds the attestation server with the real verifiers, persistent stores, the
 * full behavioural risk provider and a KMS-backed JIT signer.
 *
 * Everything is resolved from configuration; when something required for
 * production is missing, `ATTESTATION_REQUIRE_PRODUCTION_DEPENDENCIES` (on by
 * default when NODE_ENV=production) makes startup fail rather than silently
 * degrade to stubs and process memory.
 */
export const buildAttestationServer = async (): Promise<AttestationServer> => {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const stores = await createStores();
  const verifiers = resolveVerifiers();
  const { signer, rotation, notes: signerNotes } = await resolveSigner();
  const mds = createMdsTrustProvider();
  const asnLookup = createAsnLookup();
  const revocationProvider = Config.android.keyAttestation.revocationEnabled
    ? new GoogleRevocationStatusProvider()
    : undefined;

  const notes = [
    ...stores.notes,
    ...verifiers.notes,
    ...signerNotes,
    mds.note,
    `ASN lookup: ${Config.asn.provider}`,
    `Android key attestation: revocation ${
      revocationProvider ? 'enabled' : 'disabled'
    }, trusted-root pinning ${
      Config.android.keyAttestation.requireTrustedRoot ? 'required' : 'advisory'
    }`,
  ];

  const decisionRecorder = new DecisionRecorder();
  const e2eHarness = createE2eHarnessRouter({
    recorder: decisionRecorder,
    velocityStore: stores.velocityStore,
  });
  if (e2eHarness) {
    notes.push(
      'E2E HARNESS MOUNTED at /attest/e2e (token-gated, never enabled in production)',
    );
  }

  app.use(createJwksRouter(signer));
  if (e2eHarness) app.use(e2eHarness);
  app.use(
    createTelegramAuthRouter({
      launchStore: stores.launchStore,
      deviceRegistry: stores.deviceRegistry,
    }),
  );
  app.use(
    createAttestationResultRouter({ store: stores.attestationResultStore }),
  );
  app.use(createNonceRouter(stores.nonceStore));
  app.use(correlateLatency(stores.nonceStore));
  app.use(
    createWebAuthnRouter({
      credentialStore: stores.webAuthnCredentialStore,
      mdsTrustProvider: mds.provider,
      onVerified: (userId, result) => stores.recentWebAuthn.put(userId, result),
    }),
  );
  app.use(
    createVerifyRouter({
      nonceStore: stores.nonceStore,
      playIntegrityVerifier: verifiers.playIntegrityVerifier,
      appAttestVerifier: verifiers.appAttestVerifier,
      deviceRegistry: stores.deviceRegistry,
      riskProvider: stores.riskProvider,
      asnLookup,
      signer,
      recentWebAuthn: stores.recentWebAuthn,
      ...(revocationProvider ? { revocationProvider } : {}),
      ...(e2eHarness
        ? { onDecision: (record) => decisionRecorder.record(record) }
        : {}),
    }),
  );

  app.use('/mobile', express.static('dist-mobile'));
  app.get('/healthz', (_req, res) =>
    res.json({
      ok: true,
      storage: stores.backends,
      jit: {
        provider: rotation.provider,
        activeKid: rotation.activeKid,
        publishedKids: rotation.publishedKids,
        rotationDue: rotation.rotationDue,
      },
    }),
  );

  return { app, notes };
};

/** Backwards-compatible entry point used by src/server.ts. */
export const createAttestationServer = async (): Promise<Express> => {
  const { app, notes } = await buildAttestationServer();
  for (const note of notes) console.log(`[attestation] ${note}`);
  return app;
};
