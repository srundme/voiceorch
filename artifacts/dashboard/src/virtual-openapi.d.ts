declare module "virtual:openapi-spec" {
  import type { OpenApiDocument } from "@/pages/docs/openapi/types";
  const spec: OpenApiDocument;
  export default spec;
}
