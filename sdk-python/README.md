# snapserve

Official Python SDK for the [SnapServe](https://snapserve.ai) AI voice agent API.

## Install

```bash
pip install snapserve
```

## Usage

Create an API key from **Dashboard → API Keys** (`sk_live_...`), then:

```python
import os
from snapserve import SnapServe

client = SnapServe(api_key=os.environ["SNAPSERVE_API_KEY"])

agents = client.agents.list()

call = client.calls.create_outbound({
    "agentId": agents[0]["id"],
    "toNumber": "+15551234567",
})

stats = client.analytics.dashboard()
```

## Resources

- `client.agents` — `list` / `get` / `create` / `update` / `delete` / `toggle`
- `client.calls` — `list` / `get` / `create` / `create_outbound` / `transfer` / `end` / `set_disposition`
- `client.providers` — `list` / `create` / `update` / `delete`
- `client.phone_numbers` — `list` / `assign` / `release`
- `client.analytics` — `dashboard` / `recent_calls` / `calls_by_status` / `daily_call_volume` / `agent_stats`
- `client.webhook_endpoints` — `list` / `create` / `update` / `delete`
- `client.wallet` — `get` / `transactions`
- `client.account` — `get`
- `client.scheduling` — `list_calendars` / `list_event_types` / `list_bookings` / `public_slots` / `public_create_booking`

Any endpoint without a typed helper is reachable directly:

```python
client.request("GET", "/campaigns")
```

## Errors

Failed requests raise `SnapServeApiError` with `.status_code` and `.body`.

```python
from snapserve import SnapServeApiError

try:
    client.agents.get(999999)
except SnapServeApiError as err:
    print(err.status_code, err)
```
