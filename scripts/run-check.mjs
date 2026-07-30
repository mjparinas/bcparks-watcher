#!/usr/bin/env node
/**
 * One-shot availability check without starting the Next server.
 * Usage: npm run check
 */

const YEAR = 2026;
const MONTH = 8;
const PARKS = [
  {
    name: "Manning",
    resourceLocationId: -2147483618,
    rootMapId: -2147483601,
  },
  {
    name: "Sasquatch",
    resourceLocationId: -2147483539,
    rootMapId: -2147483420,
  },
];

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function augustFridays(year) {
  const daysInMonth = new Date(Date.UTC(year, MONTH, 0)).getUTCDate();
  const fridays = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(year, MONTH - 1, day));
    if (date.getUTCDay() === 5) fridays.push(date);
  }
  return fridays;
}

async function fetchMap(mapId, resourceLocationId, startDate, endDate) {
  const params = new URLSearchParams({
    mapId: String(mapId),
    resourceLocationId: String(resourceLocationId),
    bookingCategoryId: "0",
    startDate,
    endDate,
    isReserving: "true",
    getDailyAvailability: "true",
    partySize: "2",
    numEquipment: "1",
    equipmentCategoryId: "-32768",
  });
  const response = await fetch(
    `https://camping.bcparks.ca/api/availability/map?${params}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "BCParksWeekendWatcher/1.0",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function collect(
  mapId,
  resourceLocationId,
  startDate,
  endDate,
  seen = new Set(),
) {
  if (seen.has(mapId) || seen.size > 40) return {};
  seen.add(mapId);
  const data = await fetchMap(mapId, resourceLocationId, startDate, endDate);
  const sites = { ...(data.resourceAvailabilities || {}) };
  for (const child of Object.keys(data.mapLinkAvailabilities || {})) {
    Object.assign(
      sites,
      await collect(
        Number(child),
        resourceLocationId,
        startDate,
        endDate,
        seen,
      ),
    );
  }
  return sites;
}

const fridays = augustFridays(YEAR);
console.log(
  `Checking ${PARKS.map((p) => p.name).join(", ")} · Aug ${YEAR} Fri–Sun\n`,
);

for (const friday of fridays) {
  const nights = [friday, addDays(friday, 1), addDays(friday, 2)];
  const startDate = formatDate(nights[0]);
  const endDate = formatDate(nights[2]);
  console.log(`Weekend ${startDate} → ${formatDate(addDays(nights[2], 1))}`);

  for (const park of PARKS) {
    const sites = await collect(
      park.rootMapId,
      park.resourceLocationId,
      startDate,
      endDate,
    );
    const counts = [0, 0, 0];
    let full = 0;
    for (const days of Object.values(sites)) {
      if (!Array.isArray(days) || days.length < 3) continue;
      let all = true;
      for (let i = 0; i < 3; i++) {
        if (days[i]?.availability === 0) counts[i] += 1;
        else all = false;
      }
      if (all) full += 1;
    }
    console.log(
      `  ${park.name.padEnd(10)} Fri ${counts[0]}  Sat ${counts[1]}  Sun ${counts[2]}  Full ${full}  (${Object.keys(sites).length} sites)`,
    );
  }
  console.log("");
}
