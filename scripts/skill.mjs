// Copy skills/chamber/SKILL.md into lib/skill.mjs, which ships in every install (the app, the
// relay's installer), so `chamber setup` can give each coding agent the current skill.
//   node scripts/skill.mjs
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const text = readFileSync(new URL("skills/chamber/SKILL.md", root), "utf8");
writeFileSync(new URL("lib/skill.mjs", root), `// Generated from skills/chamber/SKILL.md by scripts/skill.mjs: edit that file, then run it.\nexport const SKILL = ${JSON.stringify(text)};\n`);
