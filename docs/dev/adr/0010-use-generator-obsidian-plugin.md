# ADR 0010: Use generator-obsidian-plugin for Project Scaffolding

**Status:** Accepted
**Date:** 2026-02-15

## Context

Starting a new Obsidian plugin requires significant boilerplate: TypeScript configuration, build
tooling, linting, formatting, spell-checking, and Obsidian API type definitions. Setting this up
manually is tedious, error-prone, and results in inconsistent project structure across plugins.

## Decision Drivers

- Reduce time from idea to working plugin skeleton
- Leverage community-maintained best practices for Obsidian plugin development
- Get extended Obsidian API type definitions beyond the official typings
- Consistent, repeatable project setup across plugins
- Access to actively maintained dev utilities (obsidian-dev-utils)

## Decision

Use [generator-obsidian-plugin](https://github.com/mnaoumov/generator-obsidian-plugin) (v11.9.1)
as the Yeoman generator to scaffold this project.

Generator inputs used:

| Prompt | Value |
|--------|-------|
| Plugin ID | `external-note-folders` |
| Plugin name | External Note Folders |
| Description | Associate Obsidian vault notes with lazily created folders under an external root using UUIDs, preserving stable associations across moves and reorganizations. |
| Full name | Ryan |
| GitHub name | hollowhemlock |
| Desktop only? | Yes |
| Funding URL | _(empty)_ |
| Enable unofficial internal API? | No |

The generator provides:

- **Build tooling** via obsidian-dev-utils (build, dev, format, lint, spellcheck commands)
- **Extended type definitions** through obsidian-typings for Obsidian's internal API
- **Code quality** via ESLint, dprint formatting, and CSpell spell-checking
- **Framework support** for Svelte and React components
- **CSS preprocessing** with SASS

## Alternatives Considered

### A. Official Obsidian sample plugin
- Pros: Minimal, officially supported, well-understood
- Cons: Bare-bones — no linting, formatting, spell-checking, or extended types out of the box;
  requires significant manual setup for production-quality tooling
- Why rejected: Too much manual configuration needed to reach a quality baseline

### B. Manual project setup
- Pros: Full control over every dependency and configuration choice
- Cons: Time-consuming, hard to keep consistent, no community-maintained updates
- Why rejected: Unnecessary effort when a well-maintained generator exists

### C. Fork/copy another plugin's setup
- Pros: Proven configuration from a working plugin
- Cons: Inherits that project's quirks, no upgrade path, manual cleanup needed
- Why rejected: Fragile and not repeatable

## Consequences

### Positive
- Immediate access to a working build pipeline with `npm run build` and `npm run dev`
- Consistent code quality enforcement from day one
- Extended Obsidian API types reduce guesswork and runtime errors
- Upstream improvements can be pulled in via generator updates

### Neutral
- Project inherits the generator's opinions on tooling (dprint over Prettier, etc.)
- Dependencies use `latest` tags by default, pinning is left to the developer

### Negative / Trade-offs
- Coupled to a third-party maintainer's decisions and release cadence
- Generated boilerplate includes framework support (React, Svelte) even if unused
- Some overrides in package.json (e.g., `boolean: npm:dry-uninstall`) are inherited without
  clear documentation of why they exist

## Non-Goals

- Evaluating or replacing individual tools within the generated scaffold (ESLint config, dprint
  rules, etc.) — those are accepted as a package deal
- Maintaining a fork of the generator

## Future Considerations

If the generator becomes unmaintained or diverges significantly from project needs, the generated
scaffold can be treated as a standalone starting point and maintained independently. The key
constraint is that obsidian-dev-utils must remain compatible with the Obsidian API version in use.

## References

- [generator-obsidian-plugin](https://github.com/mnaoumov/generator-obsidian-plugin)
- [obsidian-dev-utils](https://github.com/mnaoumov/obsidian-dev-utils)
- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
