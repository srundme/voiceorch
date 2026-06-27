import type { Chapter } from "../types";

export const contractFirstOpenapi: Chapter = {
  slug: "contract-first-openapi",
  moduleId: "m3",
  number: "3.3",
  title: "Contract-First: One Spec, Two Codegens",
  summary:
    "How the OpenAPI file generates both server validation schemas and frontend data hooks.",
  estMinutes: 16,
  fileRef: "lib/api-spec/openapi.yaml",
  prerequisites: ["express-app"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Here's a problem every full-stack app fights: the frontend and backend must **agree** on the exact shape of every request and response. The dashboard sends a 'create agent' body; the server must accept exactly those fields and return exactly the shape the dashboard expects. Keep two copies of that contract — one in React, one in Express — and they drift apart within a week. A renamed field breaks production silently.",
        "SnapServe solves this with **contract-first** development. There is **one** source of truth: `lib/api-spec/openapi.yaml`, a 10,000-line description of every endpoint, parameter, and data shape. From that single file, a tool called **Orval** generates *two* things automatically: Zod validation schemas the **server** uses to validate requests, and TanStack Query hooks the **frontend** uses to call the API. Change the spec, re-run codegen, and both sides update in lockstep. No drift, ever.",
      ],
    },
    {
      kind: "concept",
      title: "What is OpenAPI?",
      body: [
        "**OpenAPI** (formerly Swagger) is a standard, language-agnostic way to describe a REST API in a structured file (YAML or JSON). It lists every **path** (`/agents`, `/agents/{id}`), every **operation** (GET, POST…), the parameters and request bodies they take, and the responses they return — all referencing reusable **schemas** under `components/schemas`.",
        "Because it's structured data rather than prose, machines can read it. Documentation tools render it as browsable docs; mock servers fake it; and — the part we care about — **code generators** turn it into real typed code in any language. The spec becomes the contract, and the code becomes a faithful translation of that contract.",
        "SnapServe's spec lives in `lib/api-spec/`, deliberately separate from both the server and the dashboard, so neither 'owns' it — it's the neutral agreement both sides compile against.",
      ],
    },
    {
      kind: "analogy",
      title: "An architect's blueprint",
      body: [
        "Imagine a building where the plumber and the electrician work in different rooms. If each draws their own sketch of where the walls go, the pipes and wires won't line up. Instead, one **master blueprint** (the OpenAPI spec) is drawn once. The plumber and the electrician both build to *that* — so the holes always meet in the middle.",
        "Orval is the photocopier that prints each trade their own working copy from the master. The backend gets a copy expressed as validation rules; the frontend gets a copy expressed as ready-to-call functions. Edit the master, reprint, and both copies stay true.",
      ],
    },
    {
      kind: "code",
      filename: "lib/api-spec/openapi.yaml",
      language: "yaml",
      intro:
        "Let's read one real path from the spec — the agents collection. This is the human-and-machine-readable contract for 'list agents' and 'create agent'.",
      code: `  /agents:
    get:
      operationId: listAgents
      tags: [agents]
      summary: List all agents
      responses:
        "200":
          description: List of agents
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Agent"
    post:
      operationId: createAgent
      tags: [agents]
      summary: Create a new agent
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/AgentInput"
      responses:
        "201":
          description: Created agent
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Agent"
        "400":
          description: Validation error`,
      lines: [
        {
          lines: "1",
          label: "/agents",
          explanation:
            "The path. Everything indented under it describes the operations available at `/api/agents`. One path can host multiple HTTP methods.",
        },
        {
          lines: "3",
          label: "operationId: listAgents",
          explanation:
            "The unique name for this operation. Orval turns it directly into code names: `listAgents()` and the `useListAgents()` React hook. Rename it here and the generated function renames too.",
        },
        {
          lines: "12-15",
          label: "the 200 response schema",
          explanation:
            "The success response is an **array of** `Agent`. The `$ref` points to a reusable schema defined once under `components/schemas` — so the response shape and any request that returns an agent all stay consistent.",
        },
        {
          lines: "20-25",
          label: "requestBody → AgentInput",
          explanation:
            "POST requires a JSON body matching the `AgentInput` schema. This is the contract the server's validator and the frontend's typed mutation both compile against — they can't disagree on what fields a new agent needs.",
        },
        {
          lines: "27-33",
          label: "201 vs 400",
          explanation:
            "The spec documents both outcomes: `201` returns the created `Agent`; `400` signals a validation error. Documenting status codes here lets the generated client know exactly what success and failure look like.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/api-spec/openapi.yaml",
      language: "yaml",
      intro:
        "Now the `AgentInput` schema those operations referenced. A schema is a reusable, named data shape with field types and constraints.",
      code: `    AgentInput:
      type: object
      required: [name, asrProvider, llmProvider, ttsProvider, telephonyProvider, systemPrompt]
      properties:
        name:
          type: string
          minLength: 1
          pattern: '\\S'
        agentMode:
          type: string
          enum: [managed, byop]
          description: "managed = use platform master keys; byop = user supplies their own provider keys"
        asrProvider:
          type: string
        llmProvider:
          type: string
          description: "LLM provider: openai, deepseek, anthropic, mistral, cohere, qwen, groq, sarvam, ultravox"
        ttsProvider:
          type: string
        telephonyProvider:
          type: string
        systemPrompt:`,
      lines: [
        {
          lines: "1-2",
          label: "AgentInput: type: object",
          explanation:
            "A named schema describing the body to create an agent. Because it's defined once, every endpoint that takes an agent body `$ref`s it — no copy-paste shapes drifting apart.",
        },
        {
          lines: "3",
          label: "required: [...]",
          explanation:
            "These six fields MUST be present. The generated Zod schema will reject a body missing any of them with a validation error — exactly the `400` the path documented.",
        },
        {
          lines: "5-8",
          label: "name constraints",
          explanation:
            "`name` is a string with `minLength: 1` and a `pattern` of `\\S` (must contain a non-whitespace character). These constraints travel into the generated Zod schema as `.min(1).regex(...)`, so a blank or whitespace-only name is rejected on the server automatically.",
        },
        {
          lines: "9-12",
          label: "agentMode enum",
          explanation:
            "An enum locks the value to `managed` or `byop`. The `description` is documentation that survives into generated comments. Enums become Zod unions of literals — only those exact strings pass.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Orval: one spec in, two code packages out",
      body: [
        "**Orval** is the code generator. Its config, `lib/api-spec/orval.config.mjs`, declares two outputs that both read the *same* `openapi.yaml`.",
        "Output one, `api-client-react`: React Query hooks (`useListAgents`, `useCreateAgent`) that the dashboard imports to fetch and mutate data — no hand-written `fetch` calls.",
        "Output two, `zod`: Zod schemas (`CreateAgentBody`, `ListAgentsResponse`) the **server** imports to validate incoming requests and shape outgoing responses. Two consumers, one contract.",
      ],
    },
    {
      kind: "code",
      filename: "lib/api-spec/orval.config.mjs",
      language: "javascript",
      intro:
        "The Orval config wires the single spec to its two targets. Notice both `input.target` lines point at the same `openapi.yaml`.",
      code: `export default defineConfig({
  "api-client-react": {
    input: {
      target: path.resolve(__dirname, "openapi.yaml"),
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      // ...
      override: {
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: path.resolve(__dirname, "openapi.yaml"),
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      mode: "split",
      // ...
    },
  },
});`,
      lines: [
        {
          lines: "2",
          label: '"api-client-react"',
          explanation:
            "The first generation target. Its output lands in the `api-client-react` package that the dashboard depends on.",
        },
        {
          lines: "8",
          label: 'client: "react-query"',
          explanation:
            "Tells Orval to emit **TanStack Query** hooks, not plain functions. That's why the dashboard gets `useListAgents()` with caching, loading states, and refetching built in.",
        },
        {
          lines: "14-17",
          label: "mutator: customFetch",
          explanation:
            "Every generated hook routes its HTTP through `custom-fetch.ts` instead of raw `fetch`. That central mutator attaches the `Authorization: Bearer` token, sets the base URL, and adds a request timeout — one place to handle auth for the whole client.",
        },
        {
          lines: "21-31",
          label: "zod target — same input",
          explanation:
            "The second target reads the **exact same** `openapi.yaml` but emits `client: \"zod\"` — runtime validators. This is the heart of contract-first: one spec, two faithful code outputs, zero drift.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/api-zod/src/generated/api.ts",
      language: "typescript",
      intro:
        "Here's the actual Zod schema Orval generated from `AgentInput` — note how the YAML constraints became runtime validation code. This file is auto-generated; nobody edits it by hand.",
      code: `/**
 * Generated by orval v8.9.1 🍺
 * Do not edit manually.
 */
import * as zod from 'zod';

export const createAgentBodyNameRegExp = new RegExp('\\\\S');

// ...
  "name": zod.string().min(1).regex(createAgentBodyNameRegExp),`,
      lines: [
        {
          lines: "1-4",
          label: "Do not edit manually",
          explanation:
            "The banner is a warning: this file is regenerated from the spec. Any manual change is wiped on the next `orval` run. To change validation, you change `openapi.yaml`.",
        },
        {
          lines: "7",
          label: "createAgentBodyNameRegExp",
          explanation:
            "The YAML `pattern: '\\S'` became a real `RegExp`. The generator faithfully carried the constraint from spec into runtime code.",
        },
        {
          lines: "10",
          label: ".min(1).regex(...)",
          explanation:
            "`minLength: 1` + `pattern` became `.min(1).regex(...)`. The server imports this schema (as `CreateAgentBody`) and calls `.safeParse(req.body)` — so a blank name is rejected with the documented `400`, no hand-written validation needed.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/api-client-react/src/generated/api.ts",
      language: "typescript",
      intro:
        "And here's the frontend half generated from the SAME path — a ready-to-use React Query hook the dashboard imports directly.",
      code: `/**
 * @summary List all agents
 */
export function useListAgents<TData = Awaited<ReturnType<typeof listAgents>>, TError = ErrorType<unknown>>(
  options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listAgents>>, TError, TData>, request?: SecondParameter<typeof customFetch>}
 ):  UseQueryResult<TData, TError> & { queryKey: QueryKey } {

  const queryOptions = getListAgentsQueryOptions(options)

  const query = useQuery(queryOptions) as  UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return { ...query, queryKey: queryOptions.queryKey };
}`,
      lines: [
        {
          lines: "2",
          label: "@summary List all agents",
          explanation:
            "The `summary:` field from the YAML path became a doc comment — your editor shows it on hover. The contract's documentation flows all the way into the developer's tooltip.",
        },
        {
          lines: "4",
          label: "useListAgents",
          explanation:
            "The `operationId: listAgents` became the hook name `useListAgents`. A dashboard component just calls `const { data } = useListAgents()` and gets a fully-typed, cached list of agents — no fetch, no URL, no manual types.",
        },
        {
          lines: "8-10",
          label: "useQuery under the hood",
          explanation:
            "The hook wraps TanStack Query's `useQuery`, so the dashboard gets loading/error states, caching, and a stable `queryKey` for free — all derived from the spec.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "The golden rule: change the spec, not the generated files",
      body: [
        "Both generated `api.ts` files shout 'Do not edit manually.' To add a field or endpoint, edit `lib/api-spec/openapi.yaml`, then re-run Orval. Both the server's Zod schemas and the frontend's hooks update together.",
        "Editing a generated file directly feels faster — until the next codegen run silently erases your change and the contract drifts. The spec is the source of truth; everything else is a printout.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "One spec fans out to both sides of the wire. Click any box to jump to its chapter.",
      nodes: [
        { id: "spec", label: "openapi.yaml", sublabel: "THIS FILE — the contract", current: true },
        { id: "orval", label: "Orval", sublabel: "orval.config.mjs codegen", current: true },
        { id: "zod", label: "api-zod schemas", sublabel: "server validation" },
        { id: "hooks", label: "api-client-react hooks", sublabel: "frontend data fetching", chapterSlug: "data-hooks" },
        { id: "routes", label: "route handlers", sublabel: "import & .safeParse()", chapterSlug: "routes-anatomy" },
        { id: "dashboard", label: "React dashboard", sublabel: "calls useListAgents()", chapterSlug: "react-vite-app" },
      ],
      edges: [
        { from: "spec", to: "orval", label: "input" },
        { from: "orval", to: "zod", label: "client: zod" },
        { from: "orval", to: "hooks", label: "client: react-query" },
        { from: "zod", to: "routes", label: "validate req.body" },
        { from: "hooks", to: "dashboard", label: "typed hooks" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt:
            "What is the single source of truth for the API contract in SnapServe?",
          choices: [
            "The route handler files in artifacts/api-server/src/routes.",
            "lib/api-spec/openapi.yaml — both the server Zod schemas and the frontend hooks are generated from it.",
            "The React components.",
            "The database schema.",
          ],
          correctIndex: 1,
          explanation:
            "Contract-first means one spec rules them all. Orval reads `openapi.yaml` and generates both the server's validation schemas and the frontend's hooks, so the two sides can't drift apart.",
        },
        {
          prompt:
            "How does the YAML `operationId: listAgents` show up in generated code?",
          choices: [
            "It's ignored.",
            "It becomes the function/hook names — `listAgents()` and the `useListAgents()` React hook.",
            "It becomes a database table.",
            "It becomes a CSS class.",
          ],
          correctIndex: 1,
          explanation:
            "Orval derives code identifiers from `operationId`. Rename it in the spec and both the generated client function and React hook rename with it.",
        },
        {
          prompt:
            "You need to add a required field to the create-agent body. Where do you make the change?",
          choices: [
            "Edit lib/api-zod/src/generated/api.ts directly.",
            "Edit the AgentInput schema in openapi.yaml, then re-run Orval so both codegens update.",
            "Edit the React component's types.",
            "Add it only to the route handler.",
          ],
          correctIndex: 1,
          explanation:
            "Generated files are overwritten on each run. Change `AgentInput` in the spec and regenerate — the server's Zod validator and the frontend's typed mutation both pick up the new field together.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Contract-first: one OpenAPI spec (`openapi.yaml`) is the single source of truth for the whole API.",
        "OpenAPI describes paths, operations, parameters, and reusable schemas in machine-readable YAML.",
        "Orval reads the spec twice and emits two packages: Zod validators for the server and React Query hooks for the frontend.",
        "Constraints like `required`, `minLength`, `pattern`, and `enum` flow from the spec into runtime Zod validation automatically.",
        "Generated files say 'Do not edit manually' — change the spec and regenerate so both sides stay in lockstep.",
        "Frontend hooks route through a `customFetch` mutator that centralizes auth, base URL, and timeouts.",
      ],
    },
  ],
};
