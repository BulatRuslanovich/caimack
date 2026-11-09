# Android releases and in-app updates

Pushing a version tag such as `v1.2.3` runs `.github/workflows/android-release.yml`.
The tag must match `frontend/package.json`; the Android build reads that version.
The workflow runs unit tests, builds and verifies a signed release APK, saves it
as an Actions artifact for 30 days, attaches it to the matching GitHub Release,
then sends the file to one configured Telegram group. Master pushes and pull
requests do not publish releases or send messages.

## GitHub Releases

The workflow uses the built-in GitHub token with `contents: write`; no additional
release token is needed. The repository must be public for unauthenticated in-app
update checks and downloads.

If the tag has no release, the publisher creates a draft with generated release
notes, uploads `caimack-vX.Y.Z-arm64.apk`, and publishes only after GitHub confirms
the attachment. Existing release descriptions are preserved: you can prepare your
own notes in a draft before pushing the tag. Rebuilding an existing release replaces
its APK attachment when its content differs, uploading the replacement before
removing the old file. Identical uploaded files are reused. If immutable releases
are enabled for your repository, a published APK cannot be replaced; publish a
new version instead.
Rebuilding an older tag does not mark it as the latest release ahead of a newer one.

A failed Telegram delivery does not remove the GitHub Release or its APK. A failed
initial APK upload leaves the new release as a draft for a later retry.

## Android update checks

The app checks the latest public GitHub Release when the activity resumes, at most
once every six hours after a successful check. Failed attempts back off for fifteen
minutes. **Settings → Updates → Check for updates** bypasses that interval.
The check uses a separate HTTPS client without music server cookies or credentials.
Only stable numeric versions newer than the installed version and a completed,
nonempty ARM64 APK attachment for that exact tag and repository are offered.

An available update appears in a dismissible banner and remains accessible in
Settings. Dismissal applies to that version only and survives restarts. Cached
updates remain available offline. A release without a ready Android APK is treated
as an unsuccessful check, rather than a claim that the installed app is up to date.
Drafts and prereleases are not offered.

The release notes dialog opens the APK download in the user's browser. Android
handles installation after download and may ask the user to allow installation
from that browser. The app does not request package installation permission.
Use the original release signing key to allow updates without uninstalling.
Users must install the first APK containing this feature manually; older APKs
cannot gain an updater until they have been updated once.

By default, builds derive the update repository from the GitHub `CAIMACK_SOURCE_URL`
(or its `caimackSourceUrl` Gradle property). CI explicitly sets
`CAIMACK_UPDATE_REPOSITORY` to the repository running the release workflow so forks
check their own releases. To override it locally:

```bash
./gradlew :app:assembleDebug -PcaimackUpdateRepository=owner/repository
```

Set `CAIMACK_UPDATE_REPOSITORY` or `-PcaimackUpdateRepository=` to an empty value
to disable checks in a custom build. A non-GitHub source URL disables checks unless
an update repository is explicitly configured. Do not embed GitHub access tokens
in the APK for private repositories.

## Retry a release after a CI fix

Commit the corrected workflow to the default branch (`master`). In GitHub, open
**Actions → Android release → Run workflow**, select **master** as the workflow
branch, and enter the existing release tag in **release_tag**, for example
`v1.2.3`. No new tag or version bump is required.

The workflow definition comes from the selected branch; application sources are
checked out from `refs/tags/<release_tag>`. Version validation, artifact names,
the APK source URL and the Telegram caption use the selected tag and its actual
commit. The normal test, signing, artifact, GitHub Release and Telegram delivery
steps still run. The publisher is checked out from the workflow's own commit so
manual runs can also publish APKs for tags predating the updater.
The selected tag must already exist and match its own `frontend/package.json`.

GitHub CLI equivalent:

```bash
gh workflow run android-release.yml --ref master -f release_tag=v1.2.3
```

This creates a new manual run using the corrected workflow. Re-running the old
failed run keeps its original workflow commit. If a previous attempt already
delivered its APK, another successful run sends another copy to the same group.

## Repository secrets

Add these in **Settings → Secrets and variables → Actions → Repository secrets**:

| Secret                      | Value                                                    |
| --------------------------- | -------------------------------------------------------- |
| `CAIMACK_KEYSTORE_BASE64`   | Base64 of the existing release `.jks` / keystore file    |
| `CAIMACK_KEYSTORE_PASSWORD` | Keystore password                                        |
| `CAIMACK_KEY_ALIAS`         | Alias of the signing key                                 |
| `CAIMACK_KEY_PASSWORD`      | Signing key password                                     |
| `TELEGRAM_BOT_TOKEN`        | Token of your bot from `@BotFather`                      |
| `TELEGRAM_CHAT_ID`          | Numeric ID of the target group, such as `-1001234567890` |

Use the same release signing key as existing installations; a different key cannot
update an already installed APK. The keystore is decoded only into the runner's
private temporary directory, never committed or uploaded, and removed at the end.
The release build disables Gradle's configuration cache to keep signing credentials
out of it.

To encode a keystore locally, write the result to a private temporary file and
paste its contents into the secret. Do not commit the file:

```bash
umask 077
base64 -w 0 /path/to/caimack-release.jks > /tmp/caimack-keystore.base64
# Add the contents to CAIMACK_KEYSTORE_BASE64, then delete this temporary file.
rm /tmp/caimack-keystore.base64
```

PowerShell alternative:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\path\caimack-release.jks')) | Set-Clipboard
```

## Telegram group

Create a bot using `@BotFather`, add it to the target group and allow it to send
documents. The bot need not be an administrator if the group's permissions already
allow sending files. Obtain the group's numeric chat ID from the Bot API `getUpdates`
response after sending a command addressed to the bot in the group, or from your
existing bot administration tooling. Keep the token in GitHub Secrets; it is not
part of the repository or the APK.

The sender calls `getChat` to check that the fixed ID is a group or supergroup
before uploading. It never selects another recipient as a fallback. A group
migration to a supergroup may require updating `TELEGRAM_CHAT_ID`.

Messages contain `caimack-v1.2.3-arm64.apk`, the release version, Android/architecture
requirements, commit and source link. The build currently targets ARM64 and Android
13 or newer, matching the Android project's configuration.

Telegram's hosted Bot API accepts documents up to 50 MB. Oversized APKs fail delivery
with an actionable error; the Actions artifact remains available. Network failures
are not retried automatically because an upload may already have succeeded.
Manually rerunning a workflow may send another copy to the same group.

## Validation

The publishing and sender tests mock external APIs and never publish or send messages:

```bash
python -m unittest discover -s tests -p 'test_telegram_apk.py'
python -m unittest discover -s tests -p 'test_publish_android_release.py'
```

After configuring secrets, push the next version tag through the existing release
process. Inspect the **Android release** workflow, the APK attachment in GitHub
Releases, and the configured group.
