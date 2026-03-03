# Procedure: Test-Driven Development Workflow

This procedure defines how to implement features and fixes using TDD with atomic commits. It applies to both human developers and LLM agents.

## Prerequisites

- Feature or fix has a clear scope (plan, issue, or task description)
- `npm test` passes on the current branch before starting

## The Cycle

Each unit of work follows **Red → Green → Refactor**, and each phase that changes code produces its own commit.

### 1. Red — Write a failing test

Write the smallest test that describes the next behavior increment. Run it and confirm it fails.

```bash
npm run test           # must see the new test fail
```

**Commit** with message: `test: <what the test asserts>`

Why commit a failing test? It records intent before implementation, makes the change reviewable in isolation, and ensures the test actually exercises something (not tautologically passing).

### 2. Green — Make it pass

Write the minimum code to make the failing test pass. Do not refactor, optimize, or generalize yet.

```bash
npm run test           # all tests pass
```

**Commit** with message: `feat: <what behavior was added>` or `bug: <what was fixed>`

### 3. Refactor — Clean up

Improve structure, naming, duplication, or readability without changing behavior. Tests must stay green throughout.

```bash
npm run test           # still passing after refactoring
```

**Commit** with message: `dev: refactor <what changed>` (only if there are meaningful changes — skip if Green code was already clean)

### 4. Repeat

Return to step 1 for the next behavior increment.

## Commit Discipline

### What makes a commit atomic

- It contains exactly one logical change
- The repo is in a valid state after the commit (tests pass, lint passes, builds)
- The commit message explains *why*, not just *what*

### Commit sequence for a typical feature

```
test: verify UUID collision returns Error status
feat: detect UUID collisions during scan
dev: extract collision check into dedicated function
test: verify duplicate UUID across renamed notes
feat: handle collision when source note was renamed
```

Each commit is independently reviewable and revertable.

### When to run lint

Run lint before pushing, not necessarily on every commit. If a refactor commit touches style, lint in that cycle:

```bash
npm run lint
```

## Guidance for LLM Agents

When an LLM is implementing via this procedure:

1. **State the test intent** before writing it — describe what behavior the test captures and why it matters.
2. **Show the failing test output** — confirm the test fails for the right reason (assertion failure on the expected behavior, not a syntax error or import failure).
3. **Minimize the Green step** — resist adding code beyond what the test requires. Premature generalization is the most common LLM failure mode.
4. **Pause for review** between cycles if the human is reviewing live. Don't batch multiple Red→Green→Refactor cycles without checkpoint.
5. **Flag uncertainty** — if the next test to write is unclear, ask rather than guess. A wrong test is worse than no test.

## Guidance for Human Developers

1. **Keep cycles short** — if a Green step takes more than ~15 minutes, the Red step probably bit off too much. Write a smaller test.
2. **Don't skip Red** — writing the implementation first and then backfilling tests defeats the design benefit of TDD. The test drives the interface.
3. **Refactor is optional per cycle** — not every Green step needs cleanup. But don't let refactoring debt accumulate across more than 2-3 cycles.

## When to Deviate

TDD is a default, not a dogma. Skip or compress the cycle for:

- **Config/tooling changes** (e.g., adding a lint rule) — no test needed, commit directly
- **Documentation-only changes** — commit directly
- **Exploratory spikes** — prototype freely, then delete and re-implement with TDD
- **Trivial one-line fixes** where the existing test suite already covers the behavior

When deviating, say so in the commit message or PR description.
