---
name: Radix UI Select empty-value constraint
description: SelectItem value="" crashes at runtime — use a sentinel string and convert in onChange/value
---

Radix UI's `<SelectItem>` throws a runtime error if `value=""`. This applies to shadcn's `<SelectItem>` wrapper too.

**Rule:** Never use `value=""` on a SelectItem. Use a sentinel like `"__none__"` for the "no selection" option and convert bidirectionally in the form field.

```tsx
<Select
  onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
  value={field.value || "__none__"}
>
  <SelectItem value="__none__">None</SelectItem>
  {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
</Select>
```

**Why:** Radix reserves `""` as the mechanism to clear the selection and show the placeholder — it cannot be an item value.

**How to apply:** Any time you add a "None / clear" option to a Select inside a react-hook-form field, use the `__none__` sentinel pattern above.
