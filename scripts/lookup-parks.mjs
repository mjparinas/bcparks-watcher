#!/usr/bin/env node
/**
 * Look up BC Parks GoingToCamp IDs for watcher.config.ts
 * Usage: npm run lookup -- "manning"
 */

const query = process.argv.slice(2).join(" ").trim();

if (query.length < 2) {
  console.error('Usage: npm run lookup -- "park name"');
  process.exit(1);
}

const response = await fetch("https://camping.bcparks.ca/api/resourceLocation", {
  headers: {
    Accept: "application/json",
    "User-Agent": "BCParksWeekendWatcher/1.0",
  },
});

if (!response.ok) {
  console.error(`Failed to fetch parks: ${response.status}`);
  process.exit(1);
}

const locations = await response.json();
const q = query.toLowerCase();
const matches = locations.filter((loc) => {
  const values = loc.localizedValues?.[0];
  if (!values) return false;
  return (
    values.fullName.toLowerCase().includes(q) ||
    values.shortName.toLowerCase().includes(q)
  );
});

if (matches.length === 0) {
  console.log(`No parks matched "${query}".`);
  process.exit(0);
}

for (const loc of matches) {
  const values = loc.localizedValues[0];
  console.log(`
{
  name: "${values.fullName}",
  shortName: "${values.shortName}",
  resourceLocationId: ${loc.resourceLocationId},
  rootMapId: ${loc.rootMapId},
  enabled: true,
},`);
}
