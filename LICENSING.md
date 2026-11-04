# Licensing Caimack

Copyright (c) 2026 Bulat Ruslanovich.

## Current code

The original Caimack software in this revision is licensed under the **GNU Affero
General Public License, version 3 only** (`AGPL-3.0-only`). The full, unmodified
license is in [LICENSE](LICENSE). This notice is a guide; the license text controls.

You may use, modify and redistribute the software, including commercially, subject
to the AGPL's conditions. In particular, if you modify the program and users
interact with your version over a network, section 13 requires a prominent offer
of the Corresponding Source to those users. Redistribution also carries source,
notice and licensing obligations. AGPL does not prohibit competing services.

## Source offers and builds

The application includes a Source code link on web sign-in/settings screens and
in Android settings. Official container builds point it at the exact repository
commit used by GitHub Actions. Do not remove an applicable source offer.

For modified or independently distributed builds, provide the complete
Corresponding Source for the running version, including relevant build and
installation scripts. A link to an unrelated upstream revision is insufficient.
Do not publish passwords, signing keys or private user data as part of an offer.

- **Web:** set `CAIMACK_SOURCE_URL` when building. The frontend Dockerfile accepts
  the build argument; local Compose builds accept the same environment variable.
- **Android:** set `CAIMACK_SOURCE_URL` or Gradle property `caimackSourceUrl` when
  building. For example, `-PcaimackSourceUrl=https://example.com/source/COMMIT`.
- The default upstream repository link is a development convenience. Publishers
  must ensure the link actually provides the source for their deployed build.

## Third-party and non-code material

The AGPL declaration is for software, not a blanket relicensing of third-party
album covers, music, fonts, models, dependencies or other material. These retain
their respective licenses and rights. Artwork appearing in product screenshots
is not a separately licensed asset pack.

Third-party license notices must be retained. In particular, the optional landing
page includes OFL-licensed fonts; its animation uses native browser APIs. See
[landing/THIRD_PARTY.md](landing/THIRD_PARTY.md).

## Contributions

New original contributions are submitted under `AGPL-3.0-only` unless an explicit
written agreement states otherwise. Contributors retain their copyright. A
contribution does not transfer ownership or automatically grant permission for
future proprietary relicensing.
