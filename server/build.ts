import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Hash of the compiled server code. The launcher compares it to spot an outdated running server. */
export async function buildId(distServer: string): Promise<string> {
  const hash = createHash("sha256");
  for (const folder of ["server", "shared"]) {
    const directory = join(distServer, folder);
    for (const name of (await readdir(directory)).filter(name => name.endsWith(".js")).sort()) {
      hash.update(name).update(await readFile(join(directory, name)));
    }
  }
  return hash.digest("hex").slice(0, 16);
}
