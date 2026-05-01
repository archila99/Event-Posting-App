const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const sharedPath = path.join(repoRoot, "shared", "eventImages.ts");

const targets = [
  path.join(repoRoot, "backend", "src", "constants", "eventImages.ts"),
  path.join(repoRoot, "frontend", "src", "constants", "eventImages.ts"),
];

function main() {
  if (!fs.existsSync(sharedPath)) {
    console.error("[sync-event-images] Missing source:", sharedPath);
    process.exit(1);
  }
  const shared = fs.readFileSync(sharedPath, "utf8").trimEnd() + "\n";

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `// GENERATED FILE — do not edit.\n// Source of truth: /shared/eventImages.ts\n\n${shared}`,
      "utf8"
    );
    console.log("[sync-event-images] Wrote", path.relative(repoRoot, target));
  }
}

main();

