import { CodeBlock } from "../CodeBlock";

export default function ApiReferencePage() {
  return (
    <div>
      <h1>API Reference</h1>
      <p>The SnapServe REST API is available at <code>https://app.snapserve.ai/api</code>. All endpoints require <code>Authorization: Bearer &lt;token&gt;</code> unless noted as public.</p>

      <h2>Agents</h2>
      <CodeBlock code={`GET    /api/agents              List all agents
POST   /api/agents              Create an agent
GET    /api/agents/:id          Get agent details
PATCH  /api/agents/:id          Update agent
DELETE /api/agents/:id          Delete agent
PATCH  /api/agents/:id/toggle   Toggle active/inactive
GET    /api/agents/:id/versions List versions`} language="text" />

      <h2>Calls</h2>
      <CodeBlock code={`GET    /api/calls               List calls (filterable by agent, date, status)
GET    /api/calls/:id           Get call details + transcript
PATCH  /api/calls/:id/end       End a live call`} language="text" />

      <h2>Providers</h2>
      <CodeBlock code={`GET    /api/providers           List providers
POST   /api/providers           Add a provider key
DELETE /api/providers/:id       Remove a provider`} language="text" />

      <h2>Scheduling</h2>
      <CodeBlock code={`GET    /api/scheduling/calendars                    List calendars
POST   /api/scheduling/calendars                    Create calendar
GET    /api/scheduling/event-types                  List event types
POST   /api/scheduling/event-types                  Create event type
GET    /api/scheduling/bookings                     List bookings
POST   /api/scheduling/public/bookings              Create booking (public, no auth)
GET    /api/scheduling/public/slots                 Get available slots (public)
GET    /api/scheduling/public/event-types/:slug     Get event type by slug (public)`} language="text" />

      <h2>Campaigns</h2>
      <CodeBlock code={`GET    /api/campaigns           List campaigns
POST   /api/campaigns           Create campaign
GET    /api/campaigns/:id       Get campaign
GET    /api/campaigns/:id/batches           List batches
POST   /api/campaigns/:id/batches           Create batch
PATCH  /api/campaigns/:id/batches/:batchId  Update batch status`} language="text" />

      <h2>Analytics</h2>
      <CodeBlock code={`GET    /api/analytics           Platform-level call analytics
GET    /api/analytics/agents/:id  Per-agent analytics`} language="text" />

      <h2>Webhooks</h2>
      <CodeBlock code={`GET    /api/webhook-endpoints   List webhook endpoints
POST   /api/webhook-endpoints   Create webhook endpoint
DELETE /api/webhook-endpoints/:id Delete endpoint`} language="text" />

      <p>All list endpoints support pagination via <code>?page=</code> and <code>?limit=</code> query params.</p>
    </div>
  );
}
