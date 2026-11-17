import { CONTENT_VERSION, rawContentPack, validateContentPack } from './index';

const result = validateContentPack(rawContentPack());
if (result.ok) {
  const p = result.pack;
  console.log(
    `content ${CONTENT_VERSION} OK — events ${p.events.length}, traits ${p.traits.length} (active ${p.traits.filter((t) => t.active).length}), backgrounds ${p.backgroundTraits.length}, companies ${p.companies.length}, NPC personalities ${p.npcPersonalities.length}`,
  );
} else {
  console.error(`content ${CONTENT_VERSION} INVALID:`);
  for (const i of result.issues) console.error(`  - ${i.path}: ${i.message}`);
  process.exitCode = 1;
}
