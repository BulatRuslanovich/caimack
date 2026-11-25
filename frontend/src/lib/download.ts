// SPDX-License-Identifier: AGPL-3.0-only

export function saveFile({ blob, fileName }: { blob: Blob; fileName: string }): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.style.display = "none";

  document.body.append(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
