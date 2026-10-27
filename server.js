import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production";
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID || "";
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || "";
const SQUARE_VERSION = "2026-09-16";

const SQUARE_BASE =
  SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";

function jsonRpc(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data ? { data } : {}) },
  };
}

function requireAuth(req, res, next) {
  if (!BRIDGE_API_KEY) {
    return res.status(500).json({ error: "BRIDGE_API_KEY is not configured" });
  }
  const auth = req.get("authorization") || "";
  if (auth !== `Bearer ${BRIDGE_API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

async function squareRequest(path, { method = "GET", body } = {}) {
  if (!SQUARE_ACCESS_TOKEN) {
    throw new Error("SQUARE_ACCESS_TOKEN is not configured");
  }

  const response = await fetch(`${SQUARE_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const err = new Error(`Square API error ${response.status}`);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

const tools = [
  {
    name: "square_list_catalog",
    description:
      "List Square catalog objects. Use this to inspect services/items, variations, and categories before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        types: {
          type: "string",
          description:
            "Comma-separated Square catalog types, e.g. ITEM,CATEGORY. Defaults to ITEM,CATEGORY.",
        },
        cursor: {
          type: "string",
          description: "Optional Square pagination cursor.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "square_get_catalog_object",
    description:
      "Retrieve one Square catalog object by ID, including its current version. Read before updating.",
    inputSchema: {
      type: "object",
      properties: {
        object_id: { type: "string" },
        include_related_objects: { type: "boolean", default: true },
      },
      required: ["object_id"],
      additionalProperties: false,
    },
  },
  {
    name: "square_search_catalog_items",
    description:
      "Search Square catalog items by text. Useful for finding a service by its client-facing name.",
    inputSchema: {
      type: "object",
      properties: {
        text_filter: { type: "string" },
        cursor: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
      },
      required: ["text_filter"],
      additionalProperties: false,
    },
  },
  {
    name: "square_list_locations",
    description: "List Square business locations.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "square_upsert_catalog_object",
    description:
      "Create or update a Square catalog object. For updates, first retrieve the current object and preserve all fields except the intentional edits. This is a write action.",
    inputSchema: {
      type: "object",
      properties: {
        object: {
          type: "object",
          description:
            "Complete Square CatalogObject payload to upsert, including id/type and current version for updates.",
        },
        idempotency_key: {
          type: "string",
          description:
            "Optional UUID. If omitted, the bridge generates one automatically.",
        },
      },
      required: ["object"],
      additionalProperties: false,
    },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case "square_list_catalog": {
      const params = new URLSearchParams();
      params.set("types", args.types || "ITEM,CATEGORY");
      if (args.cursor) params.set("cursor", args.cursor);
      return squareRequest(`/v2/catalog/list?${params.toString()}`);
    }

    case "square_get_catalog_object": {
      const params = new URLSearchParams();
      params.set(
        "include_related_objects",
        String(args.include_related_objects !== false)
      );
      return squareRequest(
        `/v2/catalog/object/${encodeURIComponent(args.object_id)}?${params.toString()}`
      );
    }

    case "square_search_catalog_items": {
      const body = {
        text_filter: args.text_filter,
        limit: args.limit || 100,
      };
      if (args.cursor) body.cursor = args.cursor;
      return squareRequest("/v2/catalog/search-catalog-items", {
        method: "POST",
        body,
      });
    }

    case "square_list_locations":
      return squareRequest("/v2/locations");

    case "square_upsert_catalog_object":
      return squareRequest("/v2/catalog/object", {
        method: "POST",
        body: {
          idempotency_key: args.idempotency_key || crypto.randomUUID(),
          object: args.object,
        },
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "square-chatgpt-bridge",
    environment: SQUARE_ENVIRONMENT,
    square_version: SQUARE_VERSION,
    location_configured: Boolean(SQUARE_LOCATION_ID),
  });
});

app.post("/mcp", requireAuth, async (req, res) => {
  const msg = req.body || {};
  const id = msg.id;

  try {
    if (msg.method === "initialize") {
      return res.json(
        jsonRpc(id, {
          protocolVersion:
            msg.params?.protocolVersion || "2026-07-28",
          capabilities: { tools: {} },
          serverInfo: {
            name: "britt-d-aesthetics-square",
            version: "1.0.0",
          },
          instructions:
            "Private Square bridge for Britt D Aesthetics. Always read the current object before editing it and make minimal changes.",
        })
      );
    }

    if (msg.method === "notifications/initialized") {
      return res.status(202).end();
    }

    if (msg.method === "ping") {
      return res.json(jsonRpc(id, {}));
    }

    if (msg.method === "tools/list") {
      return res.json(jsonRpc(id, { tools }));
    }

    if (msg.method === "tools/call") {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      const result = await callTool(name, args);
      return res.json(
        jsonRpc(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
          isError: false,
        })
      );
    }

    return res
      .status(404)
      .json(jsonRpcError(id, -32601, `Method not found: ${msg.method}`));
  } catch (error) {
    const details = error?.payload || { message: error?.message || String(error) };
    return res.status(200).json(
      jsonRpc(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(details, null, 2),
          },
        ],
        structuredContent: details,
        isError: true,
      })
    );
  }
});

app.get("/", (_req, res) => {
  res.type("text").send("Britt D Aesthetics Square MCP bridge is running.");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Square MCP bridge listening on port ${PORT}`);
});
