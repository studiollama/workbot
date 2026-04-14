import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { generate } from "selfsigned";
import { STORE_DIR } from "./paths.js";

const CERTS_DIR = join(STORE_DIR, "certs");
const KEY_PATH = join(CERTS_DIR, "server.key");
const CERT_PATH = join(CERTS_DIR, "server.crt");

export async function ensureCerts(): Promise<{ key: string; cert: string }> {
  // If certs already exist (user-provided or previously generated), use them
  if (existsSync(KEY_PATH) && existsSync(CERT_PATH)) {
    return {
      key: readFileSync(KEY_PATH, "utf-8"),
      cert: readFileSync(CERT_PATH, "utf-8"),
    };
  }

  // Generate self-signed certs
  const attrs = [{ name: "commonName", value: "localhost" }];
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 1);

  const pems = await generate(attrs, {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate: notAfter,
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
        ],
      },
    ],
  });

  if (!existsSync(CERTS_DIR)) mkdirSync(CERTS_DIR, { recursive: true });
  writeFileSync(KEY_PATH, pems.private);
  writeFileSync(CERT_PATH, pems.cert);
  console.log("Generated self-signed TLS certificate in .workbot/certs/");

  return { key: pems.private, cert: pems.cert };
}

export { CERTS_DIR, KEY_PATH, CERT_PATH };
