import { loadElasticConfig } from "../src/config.js";
import { bootstrapElastic } from "../src/elastic/bootstrap.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Environment variables may be supplied by the deployment platform.
}

const config = loadElasticConfig(process.env);
if (!config) {
  throw new Error(
    "Elastic is not configured. Set ELASTICSEARCH_URL, KIBANA_URL, ELASTICSEARCH_API_KEY, and KIBANA_API_KEY.",
  );
}
if (!config.enabled) {
  throw new Error(config.disabledReason ?? "Elastic is disabled.");
}

const result = await bootstrapElastic(config);
console.log(
  [
    `Index: ${result.index}`,
    `Agent: ${result.agent_id}`,
    `Tools: ${result.tools.join(", ")}`,
    "Next: npm run elastic:reindex",
  ].join("\n"),
);
