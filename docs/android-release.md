# Android releases to Telegram

Pushing a version tag such as `v1.2.3` runs `.github/workflows/android-release.yml`.
The tag must match `frontend/package.json`; the Android build reads that version.
The workflow runs unit tests, builds and verifies a signed release APK, saves it
as an Actions artifact for 30 days, then sends the file to one configured Telegram
group. It does not create a GitHub Release. Master pushes and pull requests do not
send messages.

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

The sender tests mock Telegram and never send actual messages:

```bash
python -m unittest discover -s tests -p 'test_telegram_apk.py'
```

After configuring secrets, push the next version tag through the existing release
process. Inspect the **Android release** workflow and the configured group.
