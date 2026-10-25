// Next's standalone output does not include .next/static by default.
// Copy it in so `node .next/standalone/server.js` serves a complete app.
import { cpSync, existsSync } from "node:fs";

const pairs = [
  [".next/static", ".next/standalone/.next/static"],
  ["public", ".next/standalone/public"],
];

for (const [from, to] of pairs) {
  if (!existsSync(from)) continue;
  cpSync(from, to, { recursive: true });
  console.log(`copied ${from} → ${to}`);
}
