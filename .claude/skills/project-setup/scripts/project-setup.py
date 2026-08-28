#!/usr/bin/env python3
"""
skills-hub: Gestiona skills compartidas entre Claude Code y Cursor.
Crea junctions (Windows) o symlinks (Mac/Linux) desde un repo central.
"""

import os
import json
import subprocess
import platform
from pathlib import Path

# --- Configuracion ---

IS_WINDOWS = platform.system() == "Windows"
HOME = Path.home()
CACHE_FILE = HOME / ".config" / "skills-hub.json"

SUPPORTED_TOOLS = {"claude", "cursor"}


# --- Deteccion del repo central ---

def is_skills_repo(path: Path) -> bool:
    """Valida que un directorio es el repo central de skills."""
    if not path.is_dir():
        return False
    if not (path / ".git").exists():
        return False
    if not (path / "global-skills").exists():
        return False
    if not (path / "external-skills").exists():
        return False
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=str(path), capture_output=True, text=True
    )
    return result.returncode == 0 and "skills" in result.stdout.lower()


def load_cache() -> "Path | None":
    """Lee la ubicacion del repo central desde el cache."""
    if not CACHE_FILE.exists():
        return None
    try:
        data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        p = Path(data.get("central_repo", ""))
        if p.exists() and is_skills_repo(p):
            return p
    except (json.JSONDecodeError, KeyError):
        pass
    return None


def save_cache(path: Path):
    """Guarda la ubicacion del repo central en cache."""
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(
        json.dumps({"central_repo": str(path)}, indent=2),
        encoding="utf-8"
    )


def find_central_repo() -> "Path | None":
    """
    Busca el repo central de skills en este orden:
    1. Cache (~/.config/skills-hub.json)
    2. Variable de entorno $SKILLS_PATH
    3. Busqueda en ~/dev/*, ~/Documents/Projects/* y ~/Documents/*
    """
    # 1. Cache
    cached = load_cache()
    if cached:
        return cached

    # 2. $SKILLS_PATH como override
    skills_env = os.environ.get("SKILLS_PATH")
    if skills_env:
        p = Path(skills_env)
        if is_skills_repo(p):
            save_cache(p)
            return p

    # 3. Busqueda dinamica
    # ~/dev es la raiz real de proyectos. Las rutas de Documents se mantienen
    # como respaldo para maquinas donde el repo aun no se movio.
    search_roots = [
        HOME / "dev",
        HOME / "Documents" / "Projects",
        HOME / "Documents",
    ]
    for root in search_roots:
        if not root.exists():
            continue
        try:
            candidates = sorted(root.iterdir())
        except PermissionError:
            continue
        for candidate in candidates:
            if candidate.is_dir() and is_skills_repo(candidate):
                save_cache(candidate)
                return candidate

    return None


def no_central_error() -> dict:
    return {
        "error": "no_central",
        "message": "No se encontro el repo central de skills.",
        "searched": [
            str(HOME / "Documents" / "Projects"),
            str(HOME / "Documents"),
        ],
    }


# --- Comandos ---

def set_central(path_str: str) -> dict:
    """Registra manualmente la ubicacion del repo central."""
    p = Path(path_str).resolve()
    if not is_skills_repo(p):
        return {"error": f"El directorio no es un repo de skills valido: {p}"}
    save_cache(p)
    return {"central": str(p), "cached": True}


def clone_repo(git_url: str, dest_str: "str | None" = None) -> dict:
    """Clona el repo central desde git y lo registra en cache."""
    dest = Path(dest_str).resolve() if dest_str else (HOME / "Documents" / "Projects" / "skills")
    if dest.exists():
        return {"error": f"El directorio ya existe: {dest}"}
    result = subprocess.run(
        ["git", "clone", git_url, str(dest)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        return {"error": f"Clone fallo: {result.stderr.strip()}"}
    if not is_skills_repo(dest):
        return {"error": "Clone exitoso pero el repo no parece un repo de skills valido"}
    save_cache(dest)
    return {"cloned": str(dest), "cached": True}


def _make_symlink(link_path: Path, target_path: Path) -> str:
    """Crea junction (Windows) o symlink (Mac/Linux). Retorna 'ok' o mensaje de error."""
    if IS_WINDOWS:
        result = subprocess.run(
            ["powershell", "-Command",
             f"New-Item -ItemType Junction -Path '{link_path}' -Target '{target_path}'"],
            capture_output=True, text=True
        )
        return "ok" if result.returncode == 0 else f"fail: {result.stderr.strip()}"
    else:
        try:
            os.symlink(target_path, link_path)
            return "ok"
        except OSError as e:
            return f"fail: {e}"


def setup_claude(project_path: Path, central: Path) -> dict:
    """Conecta .claude/skills al repo central via symlink completo."""
    claude_dir = project_path / ".claude"
    skills_link = claude_dir / "skills"

    claude_dir.mkdir(parents=True, exist_ok=True)

    if skills_link.is_symlink():
        current_target = Path(os.readlink(str(skills_link))).resolve()
        if current_target == central.resolve():
            return {"status": "already_linked", "target": str(central)}
        return {
            "status": "exists_different_target",
            "current": str(current_target),
            "expected": str(central),
        }

    if skills_link.exists():
        return {
            "status": "conflict",
            "message": ".claude/skills existe como directorio real — eliminalo manualmente antes de conectar.",
        }

    result = _make_symlink(skills_link, central)
    if result == "ok":
        return {"status": "linked", "target": str(central)}
    return {"status": "error", "message": result}


def setup_cursor(project_path: Path, central: Path) -> dict:
    """Conecta .cursor/rules/shared al repo central via symlink."""
    cursor_rules = project_path / ".cursor" / "rules"
    cursor_central = central / "cursor-rules" / "shared"

    if not cursor_central.exists():
        return {"status": "skipped", "message": "No se encontro cursor-rules/shared/ en el repo central"}

    cursor_rules.mkdir(parents=True, exist_ok=True)
    shared_link = cursor_rules / "shared"

    if shared_link.is_symlink():
        current_target = Path(os.readlink(str(shared_link))).resolve()
        if current_target == cursor_central.resolve():
            return {"status": "already_linked", "target": str(cursor_central)}
        return {
            "status": "exists_different_target",
            "current": str(current_target),
            "expected": str(cursor_central),
        }

    if shared_link.exists():
        return {
            "status": "conflict",
            "message": ".cursor/rules/shared existe como directorio real — eliminalo manualmente.",
        }

    # Crear carpeta de reglas de proyecto (real, unica por proyecto)
    (cursor_rules / "project").mkdir(exist_ok=True)

    result = _make_symlink(shared_link, cursor_central)
    if result == "ok":
        return {"status": "linked", "target": str(cursor_central)}
    return {"status": "error", "message": result}


def setup_project(project_path, tools=None):
    """Configura un proyecto conectando skills al repo central."""
    project_path = Path(project_path).resolve()
    central = find_central_repo()

    if not central:
        return no_central_error()

    if tools is None:
        tools = ["claude"]

    results = {"central": str(central), "project": str(project_path), "tools": {}}

    for tool_name in tools:
        if tool_name == "claude":
            results["tools"]["claude"] = setup_claude(project_path, central)
        elif tool_name == "cursor":
            results["tools"]["cursor"] = setup_cursor(project_path, central)
        else:
            results["tools"][tool_name] = {"error": f"Herramienta '{tool_name}' no soportada. Opciones: claude, cursor"}

    return results


def install_skill(git_url, skill_name=None):
    """Instala una skill desde un repo git al repo central."""
    central = find_central_repo()
    if not central:
        return no_central_error()

    import tempfile
    tmp = Path(tempfile.mkdtemp())

    try:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", git_url, str(tmp / "repo")],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            return {"error": f"Git clone fallo: {result.stderr.strip()}"}

        cloned = tmp / "repo"
        skills_found = list(cloned.rglob("SKILL.md"))

        if not skills_found:
            return {"error": "No se encontro ningun SKILL.md en el repo"}

        installed = []
        for skill_md in skills_found:
            skill_dir = skill_md.parent
            name = skill_name or skill_dir.name
            dest = central / "external-skills" / name

            if dest.exists():
                installed.append({"name": name, "status": "already_exists"})
                continue

            import shutil
            shutil.copytree(skill_dir, dest)
            installed.append({"name": name, "status": "installed", "path": str(dest)})

        return {"installed": installed}

    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


def list_skills():
    """Lista todas las skills del repo central."""
    central = find_central_repo()
    if not central:
        return no_central_error()

    result = {"central": str(central), "categories": {}}

    for category in ["global-skills", "project-skills", "external-skills"]:
        cat_dir = central / category
        if not cat_dir.exists():
            continue

        skills = []
        for skill_dir in sorted(cat_dir.iterdir()):
            skill_md = skill_dir / "SKILL.md"
            if skill_md.exists():
                content = skill_md.read_text(encoding="utf-8")
                name = skill_dir.name
                desc = ""
                for line in content.split("\n"):
                    if line.strip().startswith("description:"):
                        desc = line.split(":", 1)[1].strip()
                        break
                skills.append({"name": name, "description": desc[:80]})

        result["categories"][category] = skills

    return result


def audit_skills():
    """Revisa skills por patrones sospechosos."""
    central = find_central_repo()
    if not central:
        return no_central_error()

    suspicious_patterns = [
        "curl ", "wget ", "nc ", "base64",
        "/etc/passwd", "eval(", "exec(",
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
        "exfiltrat", "inject", "override system",
        "ignore previous", "ignore all instructions",
        "rm -rf", "format c:",
    ]

    findings = []
    for skill_md in central.rglob("SKILL.md"):
        content = skill_md.read_text(encoding="utf-8").lower()
        matched = [p for p in suspicious_patterns if p.lower() in content]
        if matched:
            findings.append({
                "file": str(skill_md.relative_to(central)),
                "patterns": matched
            })

    return {"scanned": len(list(central.rglob("SKILL.md"))), "findings": findings}


GITATTRIBUTES_CONTENT = """\
* text=auto eol=lf

*.js    text eol=lf
*.jsx   text eol=lf
*.ts    text eol=lf
*.tsx   text eol=lf
*.vue   text eol=lf
*.py    text eol=lf
*.sql   text eol=lf
*.prisma text eol=lf

*.json  text eol=lf
*.md    text eol=lf
*.yaml  text eol=lf
*.yml   text eol=lf
*.toml  text eol=lf
*.css   text eol=lf
*.html  text eol=lf
*.env*  text eol=lf

*.png   binary
*.jpg   binary
*.jpeg  binary
*.gif   binary
*.ico   binary
*.pdf   binary
*.woff  binary
*.woff2 binary
"""

PRETTIERRC_CONTENT = '{ "semi": true, "singleQuote": true, "tabWidth": 2, "printWidth": 100, "trailingComma": "es5" }\n'

GITIGNORE_CLAUDE = """
# Claude (skills symlink + local config)
.claude/skills
.claude/skills/
"""


def _detect_project(project_path: Path) -> dict:
    """Detecta tipo de proyecto y package manager."""
    info = {"type": "unknown", "pm": None, "is_monorepo": False, "frameworks": []}

    pkg_json = project_path / "package.json"
    if pkg_json.exists():
        try:
            pkg = json.loads(pkg_json.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pkg = {}

        info["type"] = "js"

        # Package manager
        if (project_path / "pnpm-lock.yaml").exists():
            info["pm"] = "pnpm"
        elif (project_path / "yarn.lock").exists():
            info["pm"] = "yarn"
        elif (project_path / "package-lock.json").exists():
            info["pm"] = "npm"

        # Monorepo
        if "workspaces" in pkg or (project_path / "pnpm-workspace.yaml").exists():
            info["is_monorepo"] = True

        # Frameworks
        all_deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        if "nuxt" in all_deps or "@nuxt/kit" in all_deps:
            info["frameworks"].append("nuxt")
        if "react" in all_deps:
            info["frameworks"].append("react")
        if "vite" in all_deps:
            info["frameworks"].append("vite")
        if "expo" in all_deps:
            info["frameworks"].append("expo")
        if "next" in all_deps:
            info["frameworks"].append("next")
        if "typescript" in all_deps or (project_path / "tsconfig.json").exists():
            info["frameworks"].append("typescript")

    elif (project_path / "requirements.txt").exists() or (project_path / "pyproject.toml").exists():
        info["type"] = "python"

    elif not any(project_path.glob("*.md")):
        info["type"] = "unknown"
    else:
        info["type"] = "docs"

    return info


def _detect_skills_status(project_path: Path) -> dict:
    """Detecta el estado de .claude/skills."""
    skills_path = project_path / ".claude" / "skills"

    if skills_path.is_symlink():
        target = str(Path(os.readlink(str(skills_path))).resolve())
        valid = skills_path.exists()
        return {"status": "symlink_repo", "target": target, "valid": valid}

    if skills_path.is_dir():
        entries = list(skills_path.iterdir())
        has_symlinks = any(e.is_symlink() for e in entries)
        if not entries:
            return {"status": "empty_dir"}
        if has_symlinks:
            return {"status": "symlink_individual", "count": sum(1 for e in entries if e.is_symlink())}
        return {"status": "real_dir", "count": len(entries)}

    return {"status": "missing"}


def check_project(project_path_str: str) -> dict:
    """Audita el estado de estandarizacion de un proyecto."""
    pp = Path(project_path_str).resolve()
    if not pp.is_dir():
        return {"error": f"No es un directorio: {pp}"}

    info = _detect_project(pp)
    skills = _detect_skills_status(pp)

    # .gitattributes
    has_gitattributes = (pp / ".gitattributes").exists()

    # .gitignore claude entries
    gitignore = pp / ".gitignore"
    has_gitignore_claude = False
    if gitignore.exists():
        content = gitignore.read_text(encoding="utf-8")
        has_gitignore_claude = ".claude/skills" in content

    # CLAUDE.md + Skills section
    claude_md = pp / "CLAUDE.md"
    has_claude_md = claude_md.exists()
    has_skills_section = False
    if has_claude_md:
        has_skills_section = "## Skills" in claude_md.read_text(encoding="utf-8")

    # ESLint
    eslint_config = None
    for name in [".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs"]:
        if (pp / name).exists():
            eslint_config = name
            break
    if not eslint_config and (pp / "package.json").exists():
        try:
            pkg = json.loads((pp / "package.json").read_text(encoding="utf-8"))
            if "eslintConfig" in pkg:
                eslint_config = "package.json (eslintConfig)"
        except json.JSONDecodeError:
            pass

    # Prettier
    has_prettier = (pp / ".prettierrc").exists() or (pp / ".prettierrc.json").exists() or (pp / "prettier.config.js").exists()

    # Husky
    has_husky = (pp / ".husky" / "pre-commit").exists()
    husky_content = None
    if has_husky:
        husky_content = (pp / ".husky" / "pre-commit").read_text(encoding="utf-8").strip()

    # lint-staged
    has_lint_staged = False
    if (pp / "package.json").exists():
        try:
            pkg = json.loads((pp / "package.json").read_text(encoding="utf-8"))
            has_lint_staged = "lint-staged" in pkg
        except json.JSONDecodeError:
            pass

    # .env.example
    has_env_example = (pp / ".env.example").exists()

    # Ruff (Python)
    has_ruff = (pp / "ruff.toml").exists() or (pp / "pyproject.toml").exists()
    has_git_hook = (pp / ".git" / "hooks" / "pre-commit").exists()

    # Lint script
    has_lint_script = False
    if (pp / "package.json").exists():
        try:
            pkg = json.loads((pp / "package.json").read_text(encoding="utf-8"))
            has_lint_script = "lint" in pkg.get("scripts", {})
        except json.JSONDecodeError:
            pass

    result = {
        "project": str(pp),
        "project_info": info,
        "skills": skills,
        "checks": {
            "gitattributes": has_gitattributes,
            "gitignore_claude": has_gitignore_claude,
            "claude_md": has_claude_md,
            "skills_section": has_skills_section,
            "eslint": eslint_config,
            "prettier": has_prettier,
            "husky": has_husky,
            "husky_content": husky_content,
            "lint_staged": has_lint_staged,
            "lint_script": has_lint_script,
            "env_example": has_env_example,
        },
    }

    if info["type"] == "python":
        result["checks"]["ruff"] = has_ruff
        result["checks"]["git_hook"] = has_git_hook

    # Missing items
    missing = []
    if not has_gitattributes:
        missing.append("gitattributes")
    if not has_gitignore_claude:
        missing.append("gitignore_claude")
    if not has_claude_md:
        missing.append("claude_md")
    elif not has_skills_section:
        missing.append("skills_section")
    if skills["status"] in ("missing", "empty_dir"):
        missing.append("skills_connection")
    if info["type"] == "js":
        if not eslint_config:
            missing.append("eslint")
        if not has_prettier:
            missing.append("prettier")
        if not has_husky:
            missing.append("husky")
        if not has_lint_staged:
            missing.append("lint_staged")
        if not has_lint_script:
            missing.append("lint_script")
    if info["type"] == "python":
        if not has_ruff:
            missing.append("ruff")
        if not has_git_hook:
            missing.append("git_hook")
    if not has_env_example:
        missing.append("env_example")

    if info["pm"] and info["pm"] != "pnpm" and info["type"] == "js":
        missing.append("suggest_pnpm")

    result["missing"] = missing
    result["score"] = f"{10 - len(missing)}/10" if len(missing) <= 10 else "0/10"

    return result


def standardize_project(project_path_str: str) -> dict:
    """Aplica los pasos mecanicos de estandarizacion (gitattributes, gitignore, prettier, skills)."""
    pp = Path(project_path_str).resolve()
    check = check_project(project_path_str)
    if "error" in check:
        return check

    actions = []
    missing = check["missing"]
    info = check["project_info"]

    # .gitattributes
    if "gitattributes" in missing:
        (pp / ".gitattributes").write_text(GITATTRIBUTES_CONTENT, encoding="utf-8")
        actions.append("created .gitattributes")

    # .gitignore claude entries
    if "gitignore_claude" in missing:
        gitignore = pp / ".gitignore"
        existing = gitignore.read_text(encoding="utf-8") if gitignore.exists() else ""
        if not existing.endswith("\n"):
            existing += "\n"
        gitignore.write_text(existing + GITIGNORE_CLAUDE, encoding="utf-8")
        actions.append("added .claude/skills to .gitignore")

    # .prettierrc
    if "prettier" in missing and info["type"] == "js":
        (pp / ".prettierrc").write_text(PRETTIERRC_CONTENT, encoding="utf-8")
        actions.append("created .prettierrc")

    # Skills connection
    if "skills_connection" in missing:
        central = find_central_repo()
        if central:
            skills_path = pp / ".claude" / "skills"
            if skills_path.is_dir() and not any(skills_path.iterdir()):
                skills_path.rmdir()
            if not skills_path.exists():
                (pp / ".claude").mkdir(parents=True, exist_ok=True)
                result = _make_symlink(skills_path, central)
                if result == "ok":
                    actions.append(f"created .claude/skills symlink -> {central}")
                else:
                    actions.append(f"failed to create symlink: {result}")
        else:
            actions.append("skipped skills symlink (no central repo found)")

    # Ruff (Python)
    if "ruff" in missing and info["type"] == "python":
        ruff_toml = pp / "ruff.toml"
        ruff_toml.write_text(
            'line-length = 100\ntarget-version = "py311"\n\n'
            '[lint]\nselect = ["E", "F", "I", "W"]\nignore = ["E501"]\n\n'
            '[format]\nquote-style = "double"\nindent-style = "space"\n',
            encoding="utf-8"
        )
        req = pp / "requirements.txt"
        if req.exists():
            content = req.read_text(encoding="utf-8")
            if "ruff" not in content:
                req.write_text(content.rstrip() + "\nruff>=0.11.0\n", encoding="utf-8")
        actions.append("created ruff.toml + added ruff to requirements.txt")

    # Report what still needs LLM
    needs_llm = []
    if "claude_md" in missing or "skills_section" in missing:
        needs_llm.append("CLAUDE.md (needs project understanding)")
    if "eslint" in missing:
        needs_llm.append("ESLint config (depends on framework)")
    if "husky" in missing or "lint_staged" in missing:
        needs_llm.append(f"husky + lint-staged (run: {info['pm'] or 'npm'} add -D husky lint-staged && npx husky init)")
    if "env_example" in missing:
        needs_llm.append(".env.example (needs code scan for env vars)")
    if "suggest_pnpm" in missing:
        needs_llm.append(f"suggest pnpm migration (currently {info['pm']})")

    return {"project": str(pp), "actions": actions, "needs_llm": needs_llm}


def verify_project(project_path_str: str) -> dict:
    """Verifica que la estandarizacion funciona correctamente."""
    pp = Path(project_path_str).resolve()
    info = _detect_project(pp)
    results = {"project": str(pp), "checks": [], "passed": True}

    if info["type"] == "js" and info["pm"]:
        pm = info["pm"]

        # Check binaries exist
        bin_dir = pp / "node_modules" / ".bin"
        for tool in ["eslint", "prettier", "husky"]:
            exists = (bin_dir / tool).exists()
            results["checks"].append({"tool": tool, "binary_exists": exists})
            if not exists and (pp / ".husky" / "pre-commit").exists():
                results["passed"] = False

        # Run lint dry check
        lint_result = subprocess.run(
            [pm, "lint"] if pm != "npx" else ["npx", "eslint", "."],
            cwd=str(pp), capture_output=True, text=True, timeout=30
        )
        lint_errors = lint_result.returncode != 0
        error_count = 0
        if lint_errors:
            for line in lint_result.stdout.split("\n") + lint_result.stderr.split("\n"):
                if "problem" in line.lower():
                    error_count_match = __import__("re").search(r"(\d+) problem", line)
                    if error_count_match:
                        error_count = int(error_count_match.group(1))
        results["checks"].append({
            "lint": "pass" if not lint_errors else "fail",
            "error_count": error_count,
            "warning": "pre-commit hook will block commits" if lint_errors and (pp / ".husky" / "pre-commit").exists() else None,
        })

    elif info["type"] == "python":
        # Check ruff
        ruff_check = subprocess.run(
            ["ruff", "check", "."],
            cwd=str(pp), capture_output=True, text=True, timeout=30
        )
        results["checks"].append({
            "ruff": "pass" if ruff_check.returncode == 0 else "fail",
            "output": ruff_check.stdout[:200] if ruff_check.returncode != 0 else None,
        })

        # Check git hook
        hook = pp / ".git" / "hooks" / "pre-commit"
        results["checks"].append({"git_hook": hook.exists() and os.access(str(hook), os.X_OK)})

    return results


def migrate_pnpm(project_path_str: str) -> dict:
    """Migra un proyecto JS de npm/yarn a pnpm."""
    pp = Path(project_path_str).resolve()
    info = _detect_project(pp)

    if info["type"] != "js":
        return {"error": "Not a JS project"}
    if info["pm"] == "pnpm":
        return {"status": "already_pnpm"}

    actions = []
    pkg_json = pp / "package.json"
    try:
        pkg = json.loads(pkg_json.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, FileNotFoundError):
        return {"error": "Cannot read package.json"}

    # Create pnpm-workspace.yaml from workspaces field
    if "workspaces" in pkg:
        workspaces = pkg["workspaces"]
        if isinstance(workspaces, dict):
            workspaces = workspaces.get("packages", [])
        yaml_content = "packages:\n" + "".join(f"  - '{w}'\n" for w in workspaces)
        (pp / "pnpm-workspace.yaml").write_text(yaml_content, encoding="utf-8")
        del pkg["workspaces"]
        actions.append("created pnpm-workspace.yaml from workspaces field")

    # Update workspace:* references in all package.json files
    workspace_names = set()
    for child_pkg in pp.rglob("package.json"):
        if "node_modules" in child_pkg.parts:
            continue
        try:
            child = json.loads(child_pkg.read_text(encoding="utf-8"))
            if "name" in child:
                workspace_names.add(child["name"])
        except json.JSONDecodeError:
            continue

    # Fix workspace refs in all package.json
    for child_pkg in pp.rglob("package.json"):
        if "node_modules" in child_pkg.parts:
            continue
        try:
            child = json.loads(child_pkg.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        changed = False
        for dep_key in ["dependencies", "devDependencies"]:
            deps = child.get(dep_key, {})
            for name, version in deps.items():
                if name in workspace_names and not version.startswith("workspace:"):
                    deps[name] = "workspace:*"
                    changed = True
        if changed:
            child_pkg.write_text(json.dumps(child, indent=2) + "\n", encoding="utf-8")
            actions.append(f"updated workspace refs in {child_pkg.relative_to(pp)}")

    # Get pnpm version
    pnpm_ver = subprocess.run(["pnpm", "--version"], capture_output=True, text=True)
    if pnpm_ver.returncode == 0:
        ver = pnpm_ver.stdout.strip()
        pkg["packageManager"] = f"pnpm@{ver}"
        actions.append(f"set packageManager to pnpm@{ver}")

    # Remove npm engine requirement
    if "engines" in pkg and "npm" in pkg["engines"]:
        del pkg["engines"]["npm"]
        if not pkg["engines"]:
            del pkg["engines"]
        actions.append("removed npm engine requirement")

    # Write updated root package.json
    pkg_json.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")

    # Delete old lockfile
    for lockfile in ["package-lock.json", "yarn.lock"]:
        lf = pp / lockfile
        if lf.exists():
            lf.unlink()
            actions.append(f"deleted {lockfile}")

    # pnpm import + install
    import_result = subprocess.run(
        ["pnpm", "import"], cwd=str(pp), capture_output=True, text=True
    )
    if import_result.returncode == 0:
        actions.append("pnpm import successful")

    # Clean node_modules and install fresh
    import shutil
    for nm in pp.rglob("node_modules"):
        if nm.is_dir():
            shutil.rmtree(nm, ignore_errors=True)
    actions.append("cleaned node_modules")

    install_result = subprocess.run(
        ["pnpm", "install"], cwd=str(pp), capture_output=True, text=True, timeout=180
    )
    if install_result.returncode == 0:
        actions.append("pnpm install successful")
    else:
        actions.append(f"pnpm install failed: {install_result.stderr[:200]}")

    return {
        "project": str(pp),
        "actions": actions,
        "needs_llm": [
            "update scripts in package.json (npm run X -> pnpm X, --filter uses package names not paths)",
            "update CLAUDE.md references from npm to pnpm",
        ],
    }


def _get_main_worktree(worktree_path: Path) -> "Path | None":
    """Dado un worktree, retorna la ruta del worktree principal via git."""
    result = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        cwd=str(worktree_path), capture_output=True, text=True
    )
    if result.returncode != 0:
        return None
    # El primer bloque "worktree <path>" es el principal
    for line in result.stdout.split("\n"):
        if line.startswith("worktree "):
            main_path = Path(line[len("worktree "):].strip()).resolve()
            if main_path != worktree_path.resolve():
                return main_path
    return None


def worktree_sync(worktree_path_str: str) -> dict:
    """
    Replica los symlinks de .claude/skills del worktree principal en un worktree secundario.
    Preserva el esquema del proyecto base (symlink al repo completo O symlinks individuales).
    """
    wt = Path(worktree_path_str).resolve()
    if not wt.is_dir():
        return {"error": f"No es un directorio: {wt}"}
    if not (wt / ".git").exists():
        return {"error": f"No es un worktree git (no existe .git): {wt}"}

    main = _get_main_worktree(wt)
    if not main:
        return {"error": "No se pudo detectar el worktree principal via 'git worktree list'"}

    src_skills = main / ".claude" / "skills"
    dst_skills = wt / ".claude" / "skills"

    if not src_skills.exists() and not src_skills.is_symlink():
        return {"error": f"El worktree principal no tiene .claude/skills configurado: {src_skills}"}

    (wt / ".claude").mkdir(parents=True, exist_ok=True)

    # Caso idempotente: dst ya es symlink al repo
    if dst_skills.is_symlink():
        return {
            "status": "already_linked",
            "main_worktree": str(main),
            "worktree": str(wt),
            "target": str(Path(os.readlink(str(dst_skills)))),
        }

    # dst ya tiene symlinks individuales: reconciliar con el base (agregar faltantes).
    if dst_skills.is_dir():
        entries = list(dst_skills.iterdir())
        if entries and all(e.is_symlink() for e in entries):
            # Si el base tambien usa symlinks individuales, computar diff y agregar faltantes.
            if src_skills.is_dir() and not src_skills.is_symlink():
                src_names = {e.name for e in src_skills.iterdir() if e.is_symlink()}
                dst_names = {e.name for e in entries}
                missing = sorted(src_names - dst_names)
                if missing:
                    actions = []
                    for name in missing:
                        src_link = src_skills / name
                        target = Path(os.readlink(str(src_link)))
                        result = _make_symlink(dst_skills / name, target)
                        if result == "ok":
                            actions.append(f"linked {name} -> {target}")
                        else:
                            actions.append(f"failed {name}: {result}")
                    return {
                        "status": "synced_partial",
                        "main_worktree": str(main),
                        "worktree": str(wt),
                        "existing_count": len(entries),
                        "added": actions,
                    }
            return {
                "status": "already_individual_symlinks",
                "main_worktree": str(main),
                "worktree": str(wt),
                "count": len(entries),
            }
        if entries:
            return {
                "status": "conflict",
                "message": f"{dst_skills} ya tiene archivos reales - resolver manualmente antes de sync",
            }
        # directorio vacio -> borrar para recrear
        dst_skills.rmdir()

    actions = []

    # Detectar esquema del base
    if src_skills.is_symlink():
        # Esquema 1: symlink al repo completo -> replicar igual
        target = Path(os.readlink(str(src_skills)))
        result = _make_symlink(dst_skills, target)
        if result == "ok":
            actions.append(f"linked .claude/skills -> {target} (repo scheme)")
        else:
            return {"error": f"Fallo al crear symlink: {result}"}
        scheme = "symlink_repo"
    elif src_skills.is_dir():
        # Esquema 2: symlinks individuales -> replicar cada uno
        dst_skills.mkdir(parents=True)
        scheme = "symlink_individual"
        for entry in sorted(src_skills.iterdir()):
            if not entry.is_symlink():
                actions.append(f"skipped {entry.name} (no es symlink en el base)")
                continue
            target = Path(os.readlink(str(entry)))
            link_path = dst_skills / entry.name
            result = _make_symlink(link_path, target)
            if result == "ok":
                actions.append(f"linked {entry.name} -> {target}")
            else:
                actions.append(f"failed {entry.name}: {result}")
    else:
        return {"error": f"Estado inesperado de {src_skills}"}

    return {
        "status": "synced",
        "scheme": scheme,
        "main_worktree": str(main),
        "worktree": str(wt),
        "actions": actions,
    }


def list_projects():
    """Lista proyectos que tienen .claude/skills conectado al repo central."""
    central = find_central_repo()
    if not central:
        return no_central_error()

    search_roots = [HOME / "Documents"]
    projects = []

    for root in search_roots:
        if not root.exists():
            continue
        for claude_dir in root.rglob(".claude"):
            # Excluir node_modules
            if "node_modules" in claude_dir.parts:
                continue

            skills_dir = claude_dir / "skills"
            if not (skills_dir.exists() or skills_dir.is_symlink()):
                continue

            is_linked = skills_dir.is_symlink()
            is_valid = is_linked and skills_dir.exists()  # False si el symlink esta roto
            target = None
            if is_linked:
                try:
                    target = str(Path(os.readlink(str(skills_dir))).resolve())
                except OSError:
                    target = None

            projects.append({
                "project": str(claude_dir.parent),
                "linked": is_linked,
                "valid": is_valid,
                "target": target,
            })

    return {"projects": projects}


# --- CLI ---
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="skills-hub")
    sub = parser.add_subparsers(dest="command")

    p_setup = sub.add_parser("setup")
    p_setup.add_argument("project_path")
    p_setup.add_argument("--tools", nargs="+", default=["claude"])

    p_install = sub.add_parser("install")
    p_install.add_argument("git_url")
    p_install.add_argument("--name")

    p_clone = sub.add_parser("clone")
    p_clone.add_argument("git_url")
    p_clone.add_argument("--dest", default=None)

    p_central = sub.add_parser("central")
    p_central.add_argument("--set", dest="set_path", default=None)

    sub.add_parser("list")
    sub.add_parser("audit")
    sub.add_parser("projects")

    p_check = sub.add_parser("check")
    p_check.add_argument("project_path")

    p_std = sub.add_parser("standardize")
    p_std.add_argument("project_path")

    p_verify = sub.add_parser("verify")
    p_verify.add_argument("project_path")

    p_migrate = sub.add_parser("migrate-pnpm")
    p_migrate.add_argument("project_path")

    p_wts = sub.add_parser("worktree-sync")
    p_wts.add_argument("worktree_path")

    args = parser.parse_args()

    if args.command == "setup":
        print(json.dumps(setup_project(args.project_path, args.tools), indent=2))
    elif args.command == "install":
        print(json.dumps(install_skill(args.git_url, args.name), indent=2))
    elif args.command == "clone":
        print(json.dumps(clone_repo(args.git_url, args.dest), indent=2))
    elif args.command == "central":
        if args.set_path:
            print(json.dumps(set_central(args.set_path), indent=2))
        else:
            central = find_central_repo()
            if central:
                print(json.dumps({"central": str(central)}, indent=2))
            else:
                print(json.dumps(no_central_error(), indent=2))
    elif args.command == "list":
        print(json.dumps(list_skills(), indent=2))
    elif args.command == "audit":
        print(json.dumps(audit_skills(), indent=2))
    elif args.command == "projects":
        print(json.dumps(list_projects(), indent=2))
    elif args.command == "check":
        print(json.dumps(check_project(args.project_path), indent=2))
    elif args.command == "standardize":
        print(json.dumps(standardize_project(args.project_path), indent=2))
    elif args.command == "verify":
        print(json.dumps(verify_project(args.project_path), indent=2))
    elif args.command == "migrate-pnpm":
        print(json.dumps(migrate_pnpm(args.project_path), indent=2))
    elif args.command == "worktree-sync":
        print(json.dumps(worktree_sync(args.worktree_path), indent=2))
    else:
        parser.print_help()
