export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RefObject {
  $ref: string;
}

export interface SchemaObject {
  $ref?: string;
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  example?: unknown;
  items?: SchemaObject | RefObject;
  properties?: Record<string, SchemaObject | RefObject>;
  required?: string[];
  additionalProperties?: boolean | SchemaObject | RefObject;
  allOf?: (SchemaObject | RefObject)[];
  oneOf?: (SchemaObject | RefObject)[];
  anyOf?: (SchemaObject | RefObject)[];
  nullable?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  deprecated?: boolean;
}

export interface ParameterObject {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  deprecated?: boolean;
  schema?: SchemaObject | RefObject;
}

export interface MediaTypeObject {
  schema?: SchemaObject | RefObject;
  example?: unknown;
}

export interface RequestBodyObject {
  description?: string;
  required?: boolean;
  content?: Record<string, MediaTypeObject>;
}

export interface ResponseObject {
  description?: string;
  content?: Record<string, MediaTypeObject>;
}

export interface OperationObject {
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  parameters?: (ParameterObject | RefObject)[];
  requestBody?: RequestBodyObject | RefObject;
  responses?: Record<string, ResponseObject | RefObject>;
  security?: Record<string, string[]>[];
}

export interface PathItemObject {
  summary?: string;
  description?: string;
  parameters?: (ParameterObject | RefObject)[];
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
}

export interface SecuritySchemeObject {
  type?: string;
  scheme?: string;
  bearerFormat?: string;
  name?: string;
  in?: string;
  description?: string;
}

export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  paths: Record<string, PathItemObject>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    parameters?: Record<string, ParameterObject>;
    securitySchemes?: Record<string, SecuritySchemeObject>;
  };
  security?: Record<string, string[]>[];
}

export function isRef(node: unknown): node is RefObject {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as RefObject).$ref === "string"
  );
}
