from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import requests

DEFAULT_BASE_URL = "https://app.snapserve.ai/api"


class SnapServeApiError(Exception):
    def __init__(self, status_code: int, message: str, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class _Http:
    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL, session: Optional[requests.Session] = None):
        if not api_key:
            raise ValueError("SnapServe SDK: api_key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()

    def request(
        self,
        method: str,
        path: str,
        body: Any = None,
        query: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = self.base_url + (path if path.startswith("/") else f"/{path}")
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if body is not None:
            headers["Content-Type"] = "application/json"

        params = {k: v for k, v in (query or {}).items() if v is not None}

        resp = self.session.request(
            method,
            url,
            headers=headers,
            params=params,
            data=json.dumps(body) if body is not None else None,
        )

        data: Any = None
        if resp.text:
            try:
                data = resp.json()
            except ValueError:
                data = resp.text

        if not resp.ok:
            message = f"SnapServe API request failed with status {resp.status_code}"
            if isinstance(data, dict) and isinstance(data.get("error"), str):
                message = data["error"]
            raise SnapServeApiError(resp.status_code, message, data)

        return data


class _AgentsResource:
    def __init__(self, http: _Http):
        self._http = http

    def list(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/agents")

    def get(self, agent_id: int) -> Dict[str, Any]:
        return self._http.request("GET", f"/agents/{agent_id}")

    def create(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request("POST", "/agents", body=input)

    def update(self, agent_id: int, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request("PATCH", f"/agents/{agent_id}", body=input)

    def delete(self, agent_id: int) -> None:
        return self._http.request("DELETE", f"/agents/{agent_id}")

    def toggle(self, agent_id: int) -> Dict[str, Any]:
        return self._http.request("PATCH", f"/agents/{agent_id}/toggle")


class _CallsResource:
    def __init__(self, http: _Http):
        self._http = http

    def list(self, agent_id: Optional[int] = None, status: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/calls", query={"agentId": agent_id, "status": status})

    def get(self, call_id: int) -> Dict[str, Any]:
        return self._http.request("GET", f"/calls/{call_id}")

    def create(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request("POST", "/calls", body=input)

    def update(self, call_id: int, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request("PATCH", f"/calls/{call_id}", body=input)

    def create_outbound(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request("POST", "/calls/outbound", body=input)

    def transfer(self, call_id: int, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request("POST", f"/calls/{call_id}/transfer", body=input)

    def end(self, call_id: int, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._http.request("PATCH", f"/calls/{call_id}/end", body=payload or {})

    def set_disposition(self, call_id: int, disposition_result: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request(
            "PATCH", f"/calls/{call_id}/disposition", body={"dispositionResult": disposition_result}
        )


class _ProvidersResource:
    def __init__(self, http: _Http):
        self._http = http

    def list(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/providers")

    def create(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request("POST", "/providers", body=input)

    def update(self, provider_id: int, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request("PATCH", f"/providers/{provider_id}", body=input)

    def delete(self, provider_id: int) -> None:
        return self._http.request("DELETE", f"/providers/{provider_id}")


class _PhoneNumbersResource:
    def __init__(self, http: _Http):
        self._http = http

    def list(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/phone-numbers")

    def assign(self, phone_number_id: int, agent_id: Optional[int]) -> Dict[str, Any]:
        return self._http.request("PATCH", f"/phone-numbers/{phone_number_id}/assign", body={"agentId": agent_id})

    def release(self, phone_number_id: int) -> None:
        return self._http.request("DELETE", f"/phone-numbers/{phone_number_id}")


class _AnalyticsResource:
    def __init__(self, http: _Http):
        self._http = http

    def dashboard(self) -> Dict[str, Any]:
        return self._http.request("GET", "/analytics/dashboard")

    def recent_calls(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/analytics/calls/recent")

    def calls_by_status(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/analytics/calls/by-status")

    def daily_call_volume(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/analytics/calls/daily")

    def agent_stats(self, agent_id: int) -> Dict[str, Any]:
        return self._http.request("GET", f"/analytics/agents/{agent_id}")


class _WebhookEndpointsResource:
    def __init__(self, http: _Http):
        self._http = http

    def list(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/webhook-endpoints")

    def create(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request("POST", "/webhook-endpoints", body=input)

    def update(self, webhook_id: int, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request("PATCH", f"/webhook-endpoints/{webhook_id}", body=input)

    def delete(self, webhook_id: int) -> None:
        return self._http.request("DELETE", f"/webhook-endpoints/{webhook_id}")


class _WalletResource:
    def __init__(self, http: _Http):
        self._http = http

    def get(self) -> Dict[str, Any]:
        return self._http.request("GET", "/wallet")

    def transactions(self, limit: int = 20, offset: int = 0) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/wallet/transactions", query={"limit": limit, "offset": offset})


class _AccountResource:
    def __init__(self, http: _Http):
        self._http = http

    def get(self) -> Dict[str, Any]:
        return self._http.request("GET", "/account")


class _SchedulingResource:
    def __init__(self, http: _Http):
        self._http = http

    def list_calendars(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/scheduling/calendars")

    def list_event_types(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/scheduling/event-types")

    def list_bookings(self) -> List[Dict[str, Any]]:
        return self._http.request("GET", "/scheduling/bookings")

    def public_slots(self, slug: str, time_zone: str, date: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._http.request(
            "GET", "/scheduling/public/slots", query={"slug": slug, "timeZone": time_zone, "date": date}
        )

    def public_create_booking(self, input: Dict[str, Any]) -> Dict[str, Any]:
        return self._http.request("POST", "/scheduling/public/bookings", body=input)


class SnapServe:
    """
    SnapServe SDK client.

        from snapserve import SnapServe
        client = SnapServe(api_key="sk_live_...")
        agents = client.agents.list()

    Any endpoint without a typed helper is reachable via `client.request(method, path, ...)`.
    """

    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL, session: Optional[requests.Session] = None):
        self._http = _Http(api_key, base_url, session)

        self.agents = _AgentsResource(self._http)
        self.calls = _CallsResource(self._http)
        self.providers = _ProvidersResource(self._http)
        self.phone_numbers = _PhoneNumbersResource(self._http)
        self.analytics = _AnalyticsResource(self._http)
        self.webhook_endpoints = _WebhookEndpointsResource(self._http)
        self.wallet = _WalletResource(self._http)
        self.account = _AccountResource(self._http)
        self.scheduling = _SchedulingResource(self._http)

    def request(self, method: str, path: str, body: Any = None, query: Optional[Dict[str, Any]] = None) -> Any:
        return self._http.request(method, path, body=body, query=query)
