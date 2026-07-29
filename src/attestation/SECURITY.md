# Android key storage and attestation

## Trust boundaries

Android System Key Verifier is a public-key verification service for E2EE
contacts. It does not store this app's private keys and it does not perform
message encryption. Private and symmetric keys remain in Android Keystore.

This repository owns the client-side pieces only:

- create a persistent, non-exportable EC device identity key;
- sign server challenges with the device identity key;
- return the Android attestation certificate chain during first enrollment;
- encrypt local secret bytes with a persistent AES-256-GCM wrapping key; and
- consume a server attestation verdict rather than treating a local certificate
  chain as proof of trust.

A backend must validate attestation before provisioning sensitive data or
accepting a new device identity.

## Device identity enrollment

1. The backend issues a random, single-use, short-lived challenge.
2. `prepareDeviceIdentityProof()` creates `creepyim.device.identity.v1` only if
   it does not already exist.
3. On first creation, the challenge is embedded in the attestation certificate.
4. The app signs a domain-separated representation of the same challenge.
5. The backend verifies the chain, challenge, public key, application identity,
   security level, Verified Boot state, device lock state, and revocation status.
6. The backend stores the public key as the device identity.
7. Later challenges use signature verification against the registered public
   key; the persistent key is not deleted and regenerated on startup.

The certificate chain is evidence to be checked, not a boolean. A non-empty
chain can be rooted in an untrusted certificate and must never be interpreted by
the client as proof that a key is hardware-backed.

## Local secrets

`encryptLocalSecret()` generates `creepyim.local.secrets.v1` as an AES-256-GCM
key in Android Keystore and returns only ciphertext and an IV. Store those two
values plus a format version in app-private storage. Never serialize or export
the AES key itself.

The native implementation uses fixed associated data (`creepyim-local-secret-v1`)
to prevent ciphertext from being silently reused in another protocol context.

## Theft and compromise model

Hardware-backed Keystore keys are non-exportable, so copying app files to a
second device does not copy the private key. Attestation lets the backend bind a
public key to a verified Android Keystore and reject weak or compromised device
states.

Attestation does not stop malware that controls the original app process from
requesting authorized key operations. Reduce that risk by using narrowly scoped
keys, fresh server challenges, rate limits, explicit device revocation, and user
authentication for high-value interactive operations.

## Android System Key Verifier

When E2EE contact-key verification is implemented, publish only public identity
keys to Android System Key Verifier. Use a stable app account ID, a distinct
device ID for each registered public key, and the contact lookup key expected by
the service. The corresponding private identity key stays in Android Keystore.
