# SAFI Trust Model

SAFI's trust model is deliberately narrow. It does not claim to certify
absolute truth. It certifies that a declared set of checks was performed on
a specific answer.

## Three trust states

- `VERIFIED` — every required check declared in the verification scope
  passed.
- `UNCERTAIN` — SAFI does not have enough evidence to say all required
  checks passed.
- `FAILED` — at least one required check failed.

These are evidence and trust signals. They are **not** generic quality
scores.

## What SAFI is actually checking

SAFI distinguishes three questions:

### Truth / Evidence

Is a factual claim supported by the available evidence?

### Fulfillment

Did the AI answer what the person actually asked?

### Completeness

Is something important missing?

Those three are different. A response can look fluent, even high quality,
and still fail on evidence, fulfillment or completeness. SAFI does not
collapse them into one number.

## Verification scope

Trust is always relative to an explicit verification scope.

If the scope is empty, SAFI cannot return `VERIFIED`. If a required check
is missing, the result is `UNCERTAIN`. If a required check fails, the
result is `FAILED`.

That means the trust label is a statement about the checks that were asked
for, not a blanket judgment about the answer.

## Deterministic aggregation

For one required check:

```text
no required checks   -> UNCERTAIN
missing check        -> UNCERTAIN
all PASS             -> VERIFIED contributing
PASS + FAIL          -> UNCERTAIN (conflict)
PASS + INCONCLUSIVE  -> UNCERTAIN (conflict)
FAIL + INCONCLUSIVE  -> FAILED
```

Optional checks do not change the trust status.

A broken verifier can never produce `PASS`. Verifier exceptions are captured
as `INCONCLUSIVE`.

## Confidence is not a secret score

SAFI does not hide behind a vague percentage. Where evidence exists, it is
shown. Where it does not, the uncertainty stays visible.

## Presentation does not increase trust

The SAFI Stamp is a read-only projection of the certificate. Presentation
can reveal trust, but it cannot raise it.

## Certification ordering

The empathy / humanizer adapter runs **before** final verification. The
certificate binds the exact text shown to the human. No semantic rewrite is
allowed after certification.

## Trust words used honestly

- `VERIFIED` means the declared checks passed.
- `UNCERTAIN` means there was not enough evidence.
- `FAILED` means a required check failed.

None of them means "this is definitely true" or "this is definitely good".
