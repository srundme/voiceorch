# Python SDK

```bash
pip install snapserve
```

```python
import os
from snapserve import SnapServe

client = SnapServe(api_key=os.environ["SNAPSERVE_API_KEY"])

agents = client.agents.list()
call = client.calls.create_outbound({"agentId": agents[0]["id"], "toNumber": "+15551234567"})
stats = client.analytics.dashboard()

# Anything not wrapped yet:
client.request("GET", "/campaigns")
```

Resource namespaces: `agents`, `calls`, `providers`, `phone_numbers`, `analytics`,
`webhook_endpoints`, `wallet`, `account`, `scheduling`. Errors raise `SnapServeApiError`
(`.status_code`, `.body`).
