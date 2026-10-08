# Security

## Supported version

For this release, the supported version is the current tagged release in
this repository.

## Reporting a vulnerability

If you find a security issue, please report it privately.

Do **not** open a public issue for a sensitive vulnerability.

If this repository has GitHub private vulnerability reporting enabled, use
that as the preferred private channel. Otherwise, contact the maintainer
directly through a private channel and allow time for a coordinated response
before disclosure.

If you are unsure whether something is sensitive, report it privately rather
than publicly.

## What SAFI is designed to protect

- the person's intent
- the person's conversation context as it flows through a transport
- credential hygiene, by keeping provider credentials out of the repository
  and out of the bundle
- the integrity of the certificate, which is handed to transports
  deep-frozen
- visibility into the companion's presence, including the ability to hide
  or close it

## Design properties worth knowing

- the core does not include LLM, search, browser, database, UI or
  provider-specific logic
- provider-specific DOM logic stays inside site adapters
- transports move messages; they do not author certified outcomes
- the SAFI Stamp is a read-only projection of the certificate
- companion interception is consent-first and is declared by the deployer
  where technically and legally permitted

## Known concerns

- Companion DOM adapters can require maintenance as provider UIs change.
- Native distribution, signing and notarization steps are platform-specific
  and may be incomplete for a given surface.
- Verifier coverage depends on the checks and evidence available.

## Scope of this document

This file is the project security policy for the public repository. It is
intentionally short. It will be expanded only when there is something
concrete to document.
