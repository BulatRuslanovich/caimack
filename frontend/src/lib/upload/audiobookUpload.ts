// SPDX-License-Identifier: AGPL-3.0-only

import {
  API_BASE,
  ApiError,
  GATEWAY_STATUSES,
  notifySessionExpired,
  refreshSession,
} from "@/lib/http";
import { requestLocale, tr } from "@/lib/i18n";

export async function uploadAudiobook(
  id: string,
  title: string,
  files: File[],
  onProgress: (percent: number) => void,
): Promise<void> {
  const body = new FormData();
  body.set("title", title);
  for (const file of files) body.append("file", file);

  const url = `${API_BASE}/audiobooks/uploads/${encodeURIComponent(id)}`;
  let response = await sendUpload(url, body, onProgress);
  if (response.status === 401 && (await refreshSession())) {
    response = await sendUpload(url, body, onProgress);
  }
  if (response.status >= 200 && response.status < 300) return;
  if (response.status === 401) {
    notifySessionExpired();
    throw new ApiError(401, tr("error.sessionExpired"));
  }

  const problem = response.response as { detail?: string; title?: string } | null;
  const message =
    problem?.detail ??
    (response.status === 413 ? tr("audiobooks.uploadTooLarge") : undefined) ??
    (GATEWAY_STATUSES.has(response.status) ? tr("error.unreachable") : undefined) ??
    problem?.title ??
    tr("upload.failedStatus", { status: response.status });
  throw new ApiError(response.status, message);
}

function sendUpload(
  url: string,
  body: FormData,
  onProgress: (percent: number) => void,
): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.setRequestHeader("Accept-Language", requestLocale());
    xhr.upload.addEventListener("progress", ({ lengthComputable, loaded, total }) => {
      if (lengthComputable && total > 0) onProgress(Math.floor((loaded / total) * 100));
    });
    xhr.upload.addEventListener("load", () => onProgress(100));
    xhr.addEventListener("load", () => resolve(xhr));
    xhr.addEventListener("error", () => reject(new ApiError(0, tr("upload.noConnection"))));
    xhr.addEventListener("abort", () => reject(new ApiError(0, tr("upload.cancelled"))));
    onProgress(0);
    xhr.send(body);
  });
}
