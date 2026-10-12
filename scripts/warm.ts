import { SCENARIOS, type ScoutResult } from "@whitespace/shared";

const base = (process.argv[2] ?? process.env.DEMO_URL ?? "http://localhost:8787").replace(
  /\/+$/,
  "",
);

async function main(): Promise<void> {
  console.log(`Warming ${SCENARIOS.length} scenario(s) on ${base}`);
  let failed = false;
  for (const scenario of SCENARIOS) {
    const started = performance.now();
    const response = await fetch(`${base}/api/scout?format=json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        concept: scenario.concept,
        cityId: scenario.cityId,
        anchors: scenario.anchors,
        categoryTags: scenario.categoryTags,
      }),
    });
    const ms = Math.round(performance.now() - started);
    if (!response.ok) {
      failed = true;
      console.error(`FAIL ${scenario.id}: HTTP ${response.status} ${await response.text()}`);
      continue;
    }
    const result = (await response.json()) as ScoutResult;
    const cached = result.trace.filter((step) => step.cached).length;
    console.log(
      `ok   ${scenario.id}: ${result.zones.length} zones in ${ms} ms, ${cached}/${result.trace.length} calls from cache`,
    );
  }
  if (failed) process.exit(1);
}

await main();
