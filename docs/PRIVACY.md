# SAFI Privacy

SAFI sits between a person and an AI system. That makes privacy central,
not optional.

## What SAFI is designed to avoid

- hidden screen capture
- hidden keyboard watching
- hidden clipboard polling
- hidden background collection
- secrets stored in the repository
- invisible overlays that stay after the user stops using SAFI

## Consent model

Capabilities are consent-first. Nothing sensitive is granted by default.
Granting and revoking are explicit.

## Companion interception

Companion interception depends on technical and legal feasibility, and it is
declared by the deployer, not assumed by the protocol. Provider-specific DOM
logic stays inside the site adapters.

## Credentials

Real-provider credentials come exclusively from environment variables.
They are not stored in the repository and not shipped in the bundle.

## Certificate content

A `SafiCertificate` binds trust status, checks, verification scope, attempt,
provider, policy, timestamp, and optionally the SHA-256 of the exact
human-facing answer. The certificate is the source of truth for the stamp.

## On-device behavior

SAFI is designed so the person can withdraw the companion presence. When
SAFI is hidden or closed as the user asked, it must not leave an invisible
touch blocker in place.

## Data minimization

Transports move messages. They do not author certified outcomes. The core
does not collect provider-specific DOM structure, credentials, or
conversation content as part of the protocol.

## Honest limits

Privacy is a property of the implementation as well as the design. Specific
host build, packaging, and platform integration steps may add their own
considerations. Read `SECURITY.md` and the relevant host docs for details.
