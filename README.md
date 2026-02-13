# agentkit-mesh

Agent-to-agent discovery and delegation via [MCP](https://modelcontextprotocol.io) (Model Context Protocol).

Agents register their capabilities, discover each other by semantic search, and delegate tasks — all through standard MCP tools.

## Quick Start

```bash
npx agentkit-mesh
```

This starts an MCP server over stdio, ready to connect to Claude Desktop, OpenClaw, or any MCP client.

## MCP Configuration

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentkit-mesh": {
      "command": "npx",
      "args": ["agentkit-mesh"]
    }
  }
}
```

### OpenClaw

Add to your OpenClaw config:

```yaml
mcp:
  agentkit-mesh:
    command: npx agentkit-mesh
```

## Architecture

```
┌─────────────┐     MCP      ┌──────────────────┐
│  AI Agent A  │◄────────────►│                  │
└─────────────┘              │  agentkit-mesh   │
                             │                  │
┌─────────────┐     MCP      │  ┌────────────┐  │
│  AI Agent B  │◄────────────►│  │  Registry   │  │
└─────────────┘              │  │  (SQLite)   │  │
                             │  └────────────┘  │
┌─────────────┐     MCP      │  ┌────────────┐  │
│  AI Agent C  │◄────────────►│  │  Discovery  │  │
└─────────────┘              │  └────────────┘  │
                             │  ┌────────────┐  │
                             │  │ Delegation  │  │
                             │  └────────────┘  │
                             └──────────────────┘
```

## MCP Tools

### `mesh_register`

Register an agent with its capabilities.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Unique agent name |
| `description` | string | What this agent does |
| `capabilities` | string[] | List of capabilities |
| `endpoint` | string | Agent's MCP endpoint URL |

### `mesh_discover`

Discover agents matching a natural language query.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Search query (e.g. "budget management") |
| `limit` | number? | Max results to return |

Returns agents ranked by relevance score with matched capability terms.

### `mesh_unregister`

Remove an agent from the registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | Agent name to remove |

### `mesh_delegate`

Delegate a task to another agent by name.

| Parameter | Type | Description |
|-----------|------|-------------|
| `targetName` | string | Name of the target agent |
| `task` | string | Task description to delegate |
| `context` | string? | Optional JSON context |

Connects to the target agent's MCP endpoint and calls its `handle_task` tool.

## Use Case: FormBridge

An HR agent filling an expense form discovers the Finance agent:

```typescript
import { AgentRegistry, DiscoveryEngine } from 'agentkit-mesh';

const registry = new AgentRegistry();

// Agents register themselves
registry.register({
  name: 'finance-agent',
  description: 'Budget management and expense approval',
  capabilities: ['budget', 'cost_center', 'expense_approval'],
  endpoint: 'http://localhost:4002/mcp',
});

// HR agent discovers who can help with budget fields
const discovery = new DiscoveryEngine();
const results = discovery.discover('budget cost center', registry);
// → [{ agent: finance-agent, score: 0.67, matchedTerms: ['budget', 'cost', 'center'] }]
```

See [examples/](examples/) for a runnable demo.

## Optional: Lore Integration

For semantic search beyond keyword matching, connect to a [Lore](https://github.com/openclaw/lore) server:

```typescript
import { LoreDiscoveryEngine } from 'agentkit-mesh';

const engine = new LoreDiscoveryEngine('http://lore:8080', registry, 'api-key');
const results = await engine.discover('financial planning');
// Falls back to text matching if Lore is unavailable
```

## Programmatic API

```typescript
import { AgentRegistry, DiscoveryEngine, DelegationClient, createServer } from 'agentkit-mesh';
```

All classes are exported for direct use without the MCP server layer.


## 🧰 AgentKit Ecosystem

| Project | Description | |
|---------|-------------|-|
| [AgentLens](https://github.com/agentkitai/agentlens) | Observability & audit trail for AI agents | |
| [Lore](https://github.com/agentkitai/lore) | Cross-agent memory and lesson sharing | |
| [AgentGate](https://github.com/agentkitai/agentgate) | Human-in-the-loop approval gateway | |
| [FormBridge](https://github.com/agentkitai/formbridge) | Agent-human mixed-mode forms | |
| [AgentEval](https://github.com/agentkitai/agenteval) | Testing & evaluation framework | |
| **agentkit-mesh** | Agent discovery & delegation | ⬅️ you are here |
| [agentkit-cli](https://github.com/agentkitai/agentkit-cli) | Unified CLI orchestrator | |
| [agentkit-guardrails](https://github.com/agentkitai/agentkit-guardrails) | Reactive policy guardrails | |

## License

ISC
