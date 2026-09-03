# Fixture MCP server

A minimal stdio MCP server used as a fixture repository for the resolver
integration test. It exposes two read-only tools.

## Usage

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fixture-mcp-repo": {
      "command": "node",
      "args": ["dist/index.mjs"]
    }
  }
}
```

## Environment

| Variable  | Required | Description                     |
| --------- | -------- | ------------------------------- |
| `FIXTURE_OPTIONAL` | no | Optional fixture setting. |

Run with `node dist/index.mjs`.