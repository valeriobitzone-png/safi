# Third-Party Notices

This file covers third-party components included or distributed with SAFI to
the extent such notices are required by their respective licenses.

Where a component is used only as a normal dependency fetched at install time
from its public registry, its license is governed by that registry package and
its own notice files. This file summarizes the categories present in this
repository and the attribution approach used.

## Runtime and build tooling

The project uses standard TypeScript tooling and a standard JavaScript test
runner as development dependencies. Those tools are separate works with their
own copyright and license notices.

For the authoritative copy of any dependency's license, see the package's
own license file in `node_modules/` after `npm ci`.

## Third-party notices approach

- No source from another project is copied into this repository in a way that
  removes its original attribution.
- No asset is included under terms incompatible with public distribution
  without being removed or replaced.
- Brand assets are not part of the Apache-2.0 software license. See
  `BRAND-ASSETS-LICENSE.md`.

## Trademark notice

Third-party marks belong to their respective owners. Use of a third-party
provider name in this repository is descriptive only and does not imply
affiliation, endorsement, or sponsorship.

## Run and review

After `npm ci`, you can inspect individual dependency licenses in
`node_modules/<package>/LICENSE` or the equivalent notice file. The
maintainer should review the full dependency set before public distribution,
especially for any asset, font, or native library with redistribution terms.
