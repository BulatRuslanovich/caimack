#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Compatibility entry point. Server management lives in caimack.sh.
set -euo pipefail
exec bash "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/caimack.sh" "$@"
