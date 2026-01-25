# Read Documentation Efficiently

Use this prompt when you need the AI to understand project documentation without reading everything.

---

## Prompt

```
I need to understand [specific topic] in this project.

Please:
1. Read the `.index.yaml` file(s) to find relevant documentation
2. Use section line ranges to read only the relevant parts
3. Check dependencies to see what else might be affected
4. Summarize what you found

Don't read entire documents - use the index system.
```

---

## When to Use

- Before making changes to understand existing patterns
- When onboarding to a new area of the codebase
- Before architectural decisions
- When debugging to understand expected behavior

---

## What to Expect

The AI will:
1. Read `docs/.index.yaml` or root `.index.yaml`
2. Find the relevant document and section
3. Read only the needed line range
4. Report what it found and any dependencies

---

## Examples

### Understanding Data Models

```
I need to understand the data models for user authentication.

Read the index, find the relevant section, and summarize:
- What entities are involved
- How they relate to each other
- What files would need to change if I modify the schema
```

### Understanding a Feature

```
I need to understand how the checkout flow works.

Use the documentation index to find and read:
- The flow definition
- Related components
- Any UX patterns that apply
```

### Before Making Changes

```
I'm going to modify the user profile feature.

Before I start, please:
1. Read the relevant docs via the index
2. Identify all dependencies (files that would be affected)
3. List what needs to stay in sync
```

---

## Tips

- Mention specific topics to help AI find the right sections
- Ask about dependencies when planning changes
- Request the AI summarize rather than quote everything
- Ask "what files would be affected" for change planning
