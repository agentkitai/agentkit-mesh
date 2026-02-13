# Examples

## FormBridge Demo

Demonstrates the core agentkit-mesh flow: register agents → discover by capability → delegate tasks.

### Scenario

An HR agent needs to fill an expense form but doesn't know budget details. It:

1. **Registers** itself and discovers that a Finance agent is also registered
2. **Discovers** the Finance agent by searching for "budget cost center"
3. **Delegates** the budget lookup to the Finance agent via MCP

### Run

```bash
npx tsx examples/formbridge-demo.ts
```

### What You'll See

```
=== FormBridge Demo: Agent-to-Agent Discovery ===

1. Registering agents...
   ✓ hr-agent registered (capabilities: employee_info, hr_data, department)
   ✓ finance-agent registered (capabilities: budget, cost_center, expense_approval)

2. HR agent discovers agents for "budget cost center"...
   → finance-agent (score: 0.60, matched: budget, cost, center)

3. HR agent would delegate to finance-agent at http://localhost:4002/mcp
   Task: "Get budget and cost center for Engineering department"
```

### In Production

Replace the simulated delegation with real MCP servers. Each agent runs `agentkit-mesh` as its MCP tool provider, enabling automatic discovery and cross-agent task delegation.
