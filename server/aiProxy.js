import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, "config/serverModels.json");

function readCatalog() {
  try {
    const raw = fs.readFileSync(CATALOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      upstreams: parsed.upstreams ?? {},
      models: Array.isArray(parsed.models) ? parsed.models : [],
    };
  } catch (error) {
    console.warn("Could not read server model catalog:", error.message);
    return { upstreams: {}, models: [] };
  }
}

function resolveUpstreamKey(catalog, model) {
  const upstream = catalog.upstreams?.[model?.upstream];
  if (!upstream?.apiKeyEnv) return null;
  const apiKey = process.env[upstream.apiKeyEnv];
  if (!apiKey) return null;
  return { baseUrl: upstream.baseUrl, apiKey };
}

// Public catalog for the client: only models whose upstream has a configured
// API key. Never exposes keys, base URLs, or the real upstream model id.
export function getServerModelCatalog() {
  const catalog = readCatalog();
  return catalog.models
    .filter((model) => model?.id && resolveUpstreamKey(catalog, model))
    .map((model) => ({ id: model.id, label: model.label ?? model.id }));
}

// Forwards an OpenAI-style chat completion to the upstream, injecting the
// server-held key and overriding the requested model with the catalog's real
// model id. Returns { status, json }.
export async function proxyChatCompletion(modelId, body) {
  const catalog = readCatalog();
  const model = catalog.models.find((entry) => entry?.id === modelId);
  if (!model) {
    return { status: 404, json: { error: { message: `Unknown server model: ${modelId}` } } };
  }

  const upstream = resolveUpstreamKey(catalog, model);
  if (!upstream) {
    return {
      status: 503,
      json: { error: { message: `No API key configured for model: ${modelId}` } },
    };
  }

  const payload = { ...(body ?? {}), model: model.model };

  try {
    const response = await fetch(`${upstream.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${upstream.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: { message: text || "Upstream returned a non-JSON response." } };
    }

    return { status: response.status, json };
  } catch (error) {
    return { status: 502, json: { error: { message: `Upstream request failed: ${error.message}` } } };
  }
}
