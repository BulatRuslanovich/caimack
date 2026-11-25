// SPDX-License-Identifier: AGPL-3.0-only

import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { expect, test } from "vitest";

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
const healthcheck = dockerfile.match(/^HEALTHCHECK[^\n]*\n\s+CMD (\[.+\])\r?$/m);
if (!healthcheck) throw new Error("Expected an exec-form frontend healthcheck");
const [command, ...args] = JSON.parse(healthcheck[1]) as string[];

test.each([
  [200, 0],
  [503, 1],
])(
  "the Docker probe exits for HTTP %i before the response body closes",
  async (status, expectedCode) => {
    let requestedPath: string | undefined;
    const server = createServer((request, response) => {
      requestedPath = request.url;
      response.writeHead(status);
      response.write("Frontend healthcheck");
    });
    server.listen(0, "127.0.0.1");

    try {
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP port");
      expect(command).toBe("node");
      const probeArgs = args.map((arg) => arg.replace(":3000/login", `:${address.port}/login`));
      const code = await new Promise<number>((resolve, reject) => {
        execFile(process.execPath, probeArgs, { timeout: 4_000 }, (error) => {
          if (!error) resolve(0);
          else if (typeof error.code === "number") resolve(error.code);
          else reject(error);
        });
      });
      expect(code).toBe(expectedCode);
      expect(requestedPath).toBe("/login");
    } finally {
      server.close();
      server.closeAllConnections();
    }
  },
);
