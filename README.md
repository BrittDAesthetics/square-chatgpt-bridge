# Square ChatGPT Bridge

Private MCP bridge for Britt D Aesthetics.

## Required Render environment variables

- `SQUARE_ACCESS_TOKEN`
- `SQUARE_LOCATION_ID`
- `SQUARE_APPLICATION_ID`
- `SQUARE_ENVIRONMENT=production`
- `BRIDGE_API_KEY` — create a long random secret to protect the MCP endpoint.

Never commit credentials to GitHub.

## Render settings

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`

The server listens on Render's `PORT` environment variable.

## Endpoints

- `GET /health` — deployment health check
- `POST /mcp` — protected MCP endpoint
- `GET /` — simple running-status page

The MCP endpoint expects:

`Authorization: Bearer <BRIDGE_API_KEY>`

## Square tools

Read:
- `square_list_catalog`
- `square_get_catalog_object`
- `square_search_catalog_items`
- `square_list_locations`

Write:
- `square_upsert_catalog_object`

For an update, read the current catalog object first, change only the intended field(s), preserve the object's current version and other data, then upsert it.

## Security

Square credentials are read only from Render environment variables. Do not place access tokens or API keys in this repository.
