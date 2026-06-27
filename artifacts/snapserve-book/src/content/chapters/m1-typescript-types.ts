import type { Chapter } from "../types";

export const typescriptTypes: Chapter = {
  slug: "typescript-types",
  moduleId: "m1",
  number: "2.4",
  title: "TypeScript: Types Without Tears",
  summary:
    "Just enough TypeScript to read SnapServe confidently — interfaces, unions, generics, and the `!` and `?` operators.",
  estMinutes: 12,
  prerequisites: ["modules-and-imports"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "SnapServe is written in **TypeScript**, not plain JavaScript. TypeScript is JavaScript plus a layer of **type annotations** — labels that say 'this variable is a number,' 'this function returns a list of agents.' The types vanish when the code runs; they exist purely to catch mistakes while you write and to document the shape of everything.",
        "You don't need to be a TypeScript expert to read this codebase — you need to recognize a handful of patterns. This chapter teaches exactly those: interfaces, union types, generics, and the two tiny punctuation marks (`?` and `!`) that confuse newcomers more than anything else. After this, the type annotations stop being noise and start being helpful signposts.",
      ],
    },
    {
      kind: "concept",
      title: "Interfaces and the `?` optional marker",
      body: [
        "An **interface** describes the shape of an object: which fields it has and what type each field is. It's a contract. If a value claims to be a `ConnectionNode`, TypeScript checks that it really has the right fields before letting your code run.",
        "A field followed by `?` is **optional** — it may be present or absent. `label: string` means the field is required; `sublabel?: string` means it's fine to leave it out. This shows up constantly in SnapServe's config objects, where most settings have sensible defaults and only a few are mandatory.",
        "The flip side of optional is **null / undefined safety**. Because `sublabel?` might be missing, TypeScript forces you to handle the 'it's not there' case — which is exactly the kind of bug (reading a field that doesn't exist) that crashes JavaScript at runtime.",
      ],
    },
    {
      kind: "analogy",
      title: "An interface is a form with required and optional fields",
      body: [
        "Think of a paper form at a clinic. Some fields have a red asterisk — name, date of birth — you *must* fill them in. Others, like 'middle name' or 'preferred nickname,' you can leave blank.",
        "An interface is that form. Required fields (`label: string`) are the asterisked ones; optional fields (`sublabel?: string`) are the blank-OK ones. TypeScript is the receptionist who refuses to accept the form until every required box is filled with the right kind of answer.",
      ],
    },
    {
      kind: "code",
      filename: "src/content/types.ts",
      language: "typescript",
      intro:
        "Here's a real interface from this very book's source. It mixes required fields, optional fields, and a union type — three patterns in five lines.",
      code: `export interface CalloutBlock {
  kind: "callout";
  variant: "why" | "tip" | "warning" | "gotcha" | "insight";
  title?: string;
  body: string[];
}`,
      lines: [
        {
          lines: "1",
          label: "export interface CalloutBlock",
          explanation:
            "Defines (and exports) the shape of a callout block. Any object typed as `CalloutBlock` must satisfy every required field below.",
        },
        {
          lines: "2",
          label: "kind: \"callout\"",
          explanation:
            "A **literal type** — not just any string, but exactly the string `\"callout\"`. This is the tag that lets TypeScript tell one kind of block from another (the discriminated-union trick you'll see next).",
        },
        {
          lines: "3",
          label: "variant: \"why\" | \"tip\" | …",
          explanation:
            "A **union of string literals**. The `|` means 'one of these.' `variant` must be exactly one of those five words — typing `\"warningg\"` is a compile error. This is how SnapServe enforces valid options without a separate enum.",
        },
        {
          lines: "4",
          label: "title?: string",
          explanation:
            "The `?` makes `title` **optional**. A callout may have a title or not. Code that reads `block.title` must cope with it being `undefined`.",
        },
        {
          lines: "5",
          label: "body: string[]",
          explanation:
            "Required, and `string[]` means 'an array of strings.' The `[]` suffix is how you say 'a list of.' So `body` is one or more paragraphs of text.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Discriminated unions: one type, many shapes",
      body: [
        "Sometimes a value can be one of several different shapes. A content block might be prose, or code, or a quiz — each with totally different fields. A **union type** (`A | B | C`) says 'this is one of these.'",
        "The clever part is the shared tag field, here called `kind`. Every block has a `kind` set to a unique literal string. Once your code checks `if (block.kind === \"code\")`, TypeScript **narrows** the type and knows you're now holding a `CodeBlock` specifically — so `block.code` and `block.language` become available with no casting. This pattern is called a **discriminated union**, and it's everywhere in SnapServe.",
      ],
    },
    {
      kind: "code",
      filename: "src/content/types.ts",
      language: "typescript",
      intro:
        "This is the real union that powers every chapter you're reading. A `ContentBlock` is exactly one of these eight shapes, told apart by its `kind` tag.",
      code: `export type ContentBlock =
  | ProseBlock
  | ConceptBlock
  | AnalogyBlock
  | CalloutBlock
  | CodeBlock
  | ConnectionsBlock
  | QuizBlock
  | KeyTakeawaysBlock;`,
      lines: [
        {
          lines: "1",
          label: "export type ContentBlock =",
          explanation:
            "A **type alias** — giving a name to a type expression. Unlike `interface`, `type` can describe unions, not just object shapes.",
        },
        {
          lines: "2-9",
          label: "| ProseBlock | ConceptBlock | …",
          explanation:
            "Each `|` adds another possible shape. A `ContentBlock` is exactly one of these eight. The renderer switches on `block.kind` and, once it matches, TypeScript knows precisely which fields are available.",
        },
        {
          lines: "2-9",
          label: "why this is powerful",
          explanation:
            "Add a ninth block type and the compiler will flag every `switch` that forgot to handle it. The type system turns 'did I cover every case?' from a guessing game into a guarantee.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Generics: a type with a blank to fill in",
      body: [
        "A **generic** is a type with a placeholder, written in angle brackets like `<T>`. It lets one function or type work with many data types while staying fully type-safe. `Array<string>` is a generic — `Array` is the reusable container, `string` fills the blank.",
        "SnapServe's data-fetching helper is generic: `customFetch<T>` lets every caller say what shape it expects back. One caller fetches `customFetch<Agent[]>`, another `customFetch<{ ok: boolean }>` — same function, different `T`, and each call site gets correctly-typed results. Without generics you'd either rewrite the function per type or fall back to the unsafe `any`.",
      ],
    },
    {
      kind: "analogy",
      title: "A generic is a labeled shipping box",
      body: [
        "A moving company uses one box design for everything. The box doesn't care what's inside — books, mugs, shoes. But you write the contents on the label so the unpacker knows what they'll find.",
        "`customFetch<T>` is that box. The fetching machinery is identical no matter what comes back; `T` is the label you write so the rest of your code knows whether it's unpacking an array of agents or a single status object.",
      ],
    },
    {
      kind: "code",
      filename: "lib/api-client-react/src/custom-fetch.ts",
      language: "typescript",
      intro:
        "The real signature of the app's fetch wrapper. The `<T>` is the generic that makes it reusable for every endpoint.",
      code: `export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {`,
      lines: [
        {
          lines: "1",
          label: "customFetch<T = unknown>",
          explanation:
            "`<T>` declares a type placeholder the caller chooses. `= unknown` is its **default** — if you don't specify, `T` is `unknown` (the safe 'I don't know yet' type that forces you to check before use).",
        },
        {
          lines: "2",
          label: "input: RequestInfo | URL",
          explanation:
            "Another union: the first argument can be a request, a string, or a `URL`. The function accepts any of them.",
        },
        {
          lines: "3",
          label: "options: CustomFetchOptions = {}",
          explanation:
            "A parameter with a **default value** of an empty object — so callers can omit options entirely. Different from the `?` on object fields, but the same idea: 'this is allowed to be left out.'",
        },
        {
          lines: "4",
          label: "): Promise<T>",
          explanation:
            "The return type is a Promise that resolves to `T` — whatever the caller asked for. Call `customFetch<Agent[]>(...)` and you get back a `Promise<Agent[]>`. The generic flows from the call site all the way to the result.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Inferred types: let the database define the shape",
      body: [
        "Writing a type for every database row by hand would be tedious and would drift out of sync the moment a column changed. SnapServe avoids that with **type inference** — deriving a type automatically from existing code.",
        "Drizzle (the database library) exposes `typeof usersTable.$inferSelect`, which means 'give me the exact TypeScript type of a row selected from this table.' Change a column in the table definition and the `User` type updates itself — no manual edits, no drift. `typeof` reads the type of a value, and `$inferSelect` is Drizzle's hook into it.",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/users.ts",
      language: "typescript",
      intro:
        "Real inferred types from the users schema. No hand-written field lists — the types are computed from the table itself.",
      code: `export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;`,
      lines: [
        {
          lines: "2",
          label: "z.infer<typeof insertUserSchema>",
          explanation:
            "`z.infer<…>` is a **generic** that extracts the TypeScript type from a Zod validation schema. So `InsertUser` is exactly the shape the validator accepts — one definition, used for both runtime checks and compile-time types.",
        },
        {
          lines: "3",
          label: "typeof usersTable.$inferSelect",
          explanation:
            "`typeof usersTable` reads the *type* of the table value; `.$inferSelect` asks Drizzle for the row shape you get back from a `SELECT`. `User` now mirrors every column automatically.",
        },
        {
          lines: "3-4",
          label: "why inference beats hand-writing",
          explanation:
            "Add a column to `usersTable` and `User` instantly includes it everywhere. The type can never silently disagree with the real table — the schema is the single source of truth.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "The `!` operator: a promise you'd better keep",
      body: [
        "The postfix `!` is the **non-null assertion**. Writing `mulawBytes[i]!` tells TypeScript 'trust me, this is not null/undefined,' silencing its safety check. You'll see it in tight loops like `audio.ts`, where the author knows the index is in range.",
        "It's a sharp tool. `!` doesn't *make* the value safe — it only *suppresses the warning*. If you're wrong, you get the exact runtime crash TypeScript was trying to prevent. Prefer a real check (`if (x)` or `x ?? fallback`) and reserve `!` for cases you can truly guarantee.",
      ],
    },
    {
      kind: "concept",
      title: "The `?.` and `??` cousins",
      body: [
        "Two more operators round out the null-safety toolkit, and they're the safe alternatives to `!`.",
        "`?.` is **optional chaining**: `row?.value` reads `value` only if `row` exists, otherwise it quietly returns `undefined` instead of crashing. You saw this in the event-loop chapter's caching code.",
        "`??` is the **nullish coalescing** operator: `sourceIdMap.get(a.id) ?? []` means 'use the map value, but if it's null or undefined, fall back to an empty array.' Together, `?.` and `??` let you read possibly-missing data without a pile of `if` checks — and without the risk of a bare `!`.",
      ],
    },
    {
      kind: "connections",
      title: "Where these types live",
      intro:
        "Types are the contracts that connect every layer of SnapServe — from the database rows up to the React components.",
      nodes: [
        { id: "types", label: "TypeScript types", sublabel: "this chapter", current: true },
        { id: "schema", label: "DB schema → inferred types", sublabel: "$inferSelect", chapterSlug: "drizzle-intro" },
        { id: "fetch", label: "customFetch<T>", sublabel: "generic data fetch", chapterSlug: "data-hooks" },
        { id: "contract", label: "OpenAPI contract", sublabel: "types from one spec", chapterSlug: "contract-first-openapi" },
        { id: "classes", label: "Classes & state", sublabel: "typed fields next", chapterSlug: "classes-and-state" },
      ],
      edges: [
        { from: "schema", to: "types", label: "infers" },
        { from: "types", to: "fetch", label: "generic T" },
        { from: "contract", to: "types", label: "generates" },
        { from: "types", to: "classes", label: "leads to" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What does the `?` mean in `title?: string`?",
          choices: [
            "The field can be any type.",
            "The field is optional — it may be present or absent.",
            "The field is a question.",
            "The field is read-only.",
          ],
          correctIndex: 1,
          explanation:
            "`?` marks an optional field. `title` may be omitted, so code reading it must handle `undefined`. Required fields have no `?`.",
        },
        {
          prompt: "In a discriminated union like `ContentBlock`, what makes the pattern work?",
          choices: [
            "Every member has the same fields.",
            "A shared literal tag field (`kind`) that lets TypeScript narrow to the exact shape after a check.",
            "They're all the same type.",
            "Nothing — it's just a list.",
          ],
          correctIndex: 1,
          explanation:
            "Each member sets `kind` to a unique literal. Checking `block.kind === \"code\"` narrows the type so the specific fields become available safely.",
        },
        {
          prompt: "What's the danger of the `!` non-null assertion in `mulawBytes[i]!`?",
          choices: [
            "It slows the code down.",
            "It only suppresses the warning — if the value really is null/undefined, you still crash at runtime.",
            "It converts the value to a string.",
            "Nothing, it's always safe.",
          ],
          correctIndex: 1,
          explanation:
            "`!` silences the compiler's null check without making anything safe. If your assumption is wrong, you get the very crash TypeScript was warning about. Prefer `?.` / `??` or a real check.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Types are compile-time labels that vanish at runtime; they catch mistakes and document shapes.",
        "An `interface` is an object's contract; `?` marks a field optional and forces you to handle 'missing.'",
        "A union (`A | B`) with a shared literal tag is a discriminated union — `kind` narrows it to one exact shape.",
        "Generics (`<T>`) make one function/type reusable and type-safe across many data types, like `customFetch<T>`.",
        "Inferred types (`$inferSelect`, `z.infer`) derive shapes from the schema so types never drift from reality.",
        "`!` suppresses null checks (risky); `?.` and `??` are the safe ways to read possibly-missing data.",
      ],
    },
  ],
};
