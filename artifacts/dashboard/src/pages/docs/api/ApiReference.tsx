import { useEffect } from "react";
import { Link } from "wouter";
import { getApiTitle, getOperationById, getServerUrl } from "../openapi/spec";
import { ApiReferenceLayout } from "./ApiReferenceLayout";
import { ApiOverview } from "./ApiOverview";
import { EndpointPage, EndpointAside } from "./EndpointPage";

export default function ApiReference({ operationId }: { operationId?: string }) {
  const baseUrl = getServerUrl();
  const op = operationId ? getOperationById(operationId) : undefined;

  useEffect(() => {
    document.title = op
      ? `${op.summary} · API Reference · SnapServe`
      : `API Reference · ${getApiTitle()}`;
  }, [op]);

  if (operationId && !op) {
    return (
      <ApiReferenceLayout>
        <div className="py-20 text-center space-y-3">
          <h1 className="text-2xl font-semibold">Endpoint not found</h1>
          <p className="text-muted-foreground">
            No operation with id <code className="text-primary">{operationId}</code> exists.
          </p>
          <Link href="/docs/api-reference" className="text-primary hover:underline">
            ← Back to API Reference
          </Link>
        </div>
      </ApiReferenceLayout>
    );
  }

  if (!op) {
    return (
      <ApiReferenceLayout>
        <ApiOverview />
      </ApiReferenceLayout>
    );
  }

  return (
    <ApiReferenceLayout rightRail={<EndpointAside key={op.id} op={op} baseUrl={baseUrl} />}>
      <EndpointPage key={op.id} op={op} baseUrl={baseUrl} />
    </ApiReferenceLayout>
  );
}
