---
name: commit-craft
description: >
  Generates high-quality conventional commit messages by analyzing staged git changes.
  Use this skill whenever the user wants to commit code, asks to create a commit, says
  "commit this", "commit my changes", "/commit", "haz commit", "commitea", or any
  variation of requesting a git commit. Also triggers when the user says "save my work",
  "push this", or asks to write a commit message. Even if the user just says "commit"
  with no other context, use this skill.
---

# Commit Craft

You are a commit message expert. Your job is to analyze staged git changes and produce
a single, precise conventional commit message — then create the commit. No back-and-forth,
no options menu. Just read the diff, understand the intent, and commit.

## Workflow

1. Run `git diff --staged` and `git status` to understand what changed
2. Analyze the changes to determine type, scope, and intent
3. Write the commit message
4. Create the commit
5. Show the user what you committed (the message + a brief `git status` after)

If nothing is staged, check `git status` for unstaged changes. Tell the user nothing is
staged and suggest what they might want to add — but don't add files without their approval.

## Message Format

Follow the Conventional Commits specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Type Selection

Pick the type based on what the diff actually shows:

| Type       | When to use |
|------------|-------------|
| `feat`     | New functionality that didn't exist before |
| `fix`      | Something was broken and now it works |
| `refactor` | Code restructured without changing behavior |
| `docs`     | Only documentation or comments changed |
| `style`    | Formatting, whitespace, semicolons — no logic change |
| `test`     | Adding or updating tests only |
| `chore`    | Dependencies, configs, build scripts, tooling |
| `perf`     | Performance improvement with no behavior change |
| `ci`       | CI/CD pipeline changes |
| `build`    | Build system or external dependency changes |
| `revert`   | Reverting a previous commit |

If the diff spans multiple types, pick the most important one. A feature that also fixes
a bug is a `feat`. A refactor that also updates docs is a `refactor`. Use your judgment —
the type should reflect the primary intent.

### Scope Inference

Infer the scope from the files and directories that changed. Some heuristics:

- Changes in `src/components/` or `app/` UI files → `ui`
- Changes in API routes, controllers, or endpoints → `api`
- Changes in database migrations, models, or schemas → `db`
- Changes in auth-related files → `auth`
- Changes in config files (`.env`, `tsconfig`, etc.) → `config`
- Changes spanning the whole project → omit the scope entirely

Keep scopes short (one word if possible). If the scope isn't obvious or the changes are
broad, just leave it out — a clean `feat: add user search` beats a forced `feat(misc): add user search`.

### Title Rules

- Max 50 characters (the type and scope count toward this)
- Start with lowercase after the colon
- Imperative mood: "add", "fix", "update", "remove" — not "added", "fixes", "updating"
- No period at the end
- Be specific: "fix login redirect loop" not "fix bug"

### Body Rules

Only include a body when the title alone isn't enough to understand the change. This
typically means:

- The "why" isn't obvious from the diff
- There's important context about the approach chosen
- Multiple things changed and a brief list helps

When you do write a body:
- Separate from title with a blank line
- Wrap lines at 72 characters
- Explain what and why, not how (the diff shows how)
- Use bullet points for multiple items

### Footer

Do NOT include Co-Authored-By lines. Keep the commit clean.

If the changes relate to an issue, add `Closes #123` or `Refs #123` as a footer —
but only if you can clearly identify the issue number from the diff context, branch
name, or recent conversation. Never guess issue numbers.

## Commit Execution

Use a heredoc to pass the message so formatting is preserved:

```bash
git commit -m "$(cat <<'EOF'
type(scope): description

Optional body here.
EOF
)"
```

## What NOT to Do

- Don't ask the user to choose between options. Just pick the best one.
- Don't stage files without explicit permission.
- Don't amend previous commits unless specifically asked.
- Don't push to remote unless specifically asked.
- Don't add emoji to commit messages.
- Don't write vague messages like "update code" or "fix stuff".
- Don't add Co-Authored-By or any co-author footers.
