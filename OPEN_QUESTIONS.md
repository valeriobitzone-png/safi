# Safi — Deliberately Open Questions

These items are intentionally NOT solved inside v0.1 Core.

They should not block the first implementation.

## 1. Signed certificates
Should Safi certificates become cryptographically signed and independently verifiable?

Candidate for v0.2+.

## 2. Verifier reputation / attestation
How does a deployment know that a verifier deserves trust?

Core currently records verifier results but does not create a global verifier reputation system.

## 3. Claim-level verification
v0.1 certifies the response as a whole.

A future version could attach verification status to individual claims.

## 4. Conflicting high-quality sources
v0.1 can return `UNCERTAIN`.

Future policy profiles may define domain-specific resolution rules.

## 5. Standard policy discovery
Should adapters advertise supported check IDs and capabilities?

Useful, but not needed for v0.1.

## 6. Distributed Safi
Could one Safi runtime ask remote Safi verifiers for attestations?

Potential future extension.

## 7. Certificate portability
Should certificates use a canonical serialization and detached signature format?

Future standards work.

## 8. User preference model
How much presentation adaptation should happen without creating profiling/privacy risks?

Keep outside Core until requirements are concrete.

## 9. Persistent trust history
Should users see long-term reliability statistics per provider/verifier?

Potential product/integration layer, not Core.

## 10. Standardized risk-domain taxonomy
Useful for policy selection, but premature for v0.1.
