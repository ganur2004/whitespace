import { SCENARIOS, type HealthStatus, type ScoutResult } from "@whitespace/shared";

const base = (process.argv[2] ?? process.env.DEMO_URL ?? "http://localhost:8787").replace(
  /\/+$/,
  "",
);

async function check(name: string, run: () => Promise<string>): Promise<boolean> {
  const started = performance.now();
  try {
    const detail = await run();
    console.log(`ok   ${name} (${Math.round(performance.now() - started)} ms) ${detail}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log(`Smoke test against ${base}`);
  const scenario = SCENARIOS[0];
  if (!scenario) throw new Error("No scenarios defined in shared/src/scenarios.ts");

  const results = [
    await check("GET /health", async () => {
      const response = await fetch(`${base}/health`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const health = (await response.json()) as HealthStatus;
      if (!health.ok) throw new Error("health is not ok");
      return health.demo ? "demo data" : health.qlooKey ? "live Qloo" : "no Qloo key";
    }),
    await check("GET /", async () => {
      const response = await fetch(`${base}/`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (!html.includes("<title>Whitespace</title>")) throw new Error("page title missing");
      return "page served";
    }),
    await check(`POST /api/scout (${scenario.id})`, async () => {
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
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const result = (await response.json()) as ScoutResult;
      if (result.cells.length === 0) throw new Error("no heatmap cells");
      if (result.zones.length === 0) throw new Error("no zones");
      const live = result.trace.filter((step) => !step.cached).length;
      return `${result.zones.length} zones, ${result.cells.length} cells, ${result.trace.length} Qloo calls (${live} live)${result.demo ? ", demo" : ""}`;
    }),
  ];

  if (results.includes(false)) process.exit(1);
}

await main();
