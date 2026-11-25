[Documentation](README.md#develop-and-release)

# Releases

A version tag triggers the Docker image and app release workflows. The app
release workflow accepts stable tags of the form `vX.Y.Z`.
Run the release script from the repository root with Node.js and Git and a clean
checkout. Commit the application changes before creating the release.

## Prepare and push a tag

Replace `X.Y.Z` with the next version. Preview the changes before creating the
version commit and tag.

```bash
node scripts/release.mjs X.Y.Z --check
node scripts/release.mjs X.Y.Z
```

The script synchronizes the frontend and desktop packages and their lockfiles
with the Rust workspace and Cargo lockfile. Android reads the version from the
frontend package. Each number in `X.Y.Z` must be between 0 and 99. Android's
numeric version code includes an offset so `1.0.0` can update installs from the
earlier `2.4.0` builds.

If the version is already set and the tag is absent, the script tags the current
commit. It leaves existing tags in place. To publish, push the commit and tag
explicitly.

```bash
git push origin HEAD
git push origin vX.Y.Z
```

## Where artifacts appear

| Workflow | Artifacts |
| --- | --- |
| [Images](../.github/workflows/images.yml) | API, web, MERT CUDA, and MERT ROCm images in GHCR. Branch pushes do not publish images. |
| [Android release](../.github/workflows/android-release.yml) | Signed ARM64 APK and staged [desktop packages](desktop.md#releases) attached to the GitHub Release. APK delivery also uses the configured Telegram group. |

For example, a stable image tag `v1.2.3` publishes `1.2.3`, `1.2`, `latest`, and
a commit SHA tag. Prerelease tags do not update `latest`. Set
`CAIMACK_VERSION=1.2.3` to pin an installation to that image release. Wait for
the workflow to finish before deploying the tag.

## Release notes

GitHub release descriptions are generated from the commits since the highest
earlier stable tag in the release's history. Use Conventional Commit subjects
such as `feat(search): add genre filters` and `fix(android): restore playback`
to put entries under **New features** and **Bug fixes**. The notes also group
breaking changes (`!` or a `BREAKING CHANGE:` footer), performance, refactoring,
documentation, maintenance and other changes. A comparison link opens the full
changelog. Descriptions already saved in GitHub are kept on retry, including
notes written in a draft.

Preview the notes from a checkout with full history and tags. Pass `HEAD` for
the upcoming release or an existing tag such as `v1.2.3`.

```bash
python scripts/release_notes.py HEAD --repository BulatRuslanovich/caimack
```

## When images rebuild

The [image planner](../scripts/image-plan.mjs) compares inputs with the previous
stable release reachable from the tag. Backend inputs include migrations.
MERT uses the Python service and its Dockerfile. Version-only changes made by
the release script are ignored. Changes to image workflow or planner inputs can
trigger rebuilds.

When the inputs match and the previous image is available in the registry, the
workflow applies the new release tags to that digest, retaining its build
version and source link. It builds fresh images on the first release, after image
workflow changes, or when a previous image is unavailable.

## Validate release tooling

```bash
node --test scripts/image-plan.test.mjs scripts/release.test.mjs
```

See [Android release automation](android-release.md) for signing and update
configuration, publication tests, and how to retry an existing tag.
