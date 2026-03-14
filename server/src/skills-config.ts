import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { STORE_DIR } from "./services.js";

const SKILLS_PATH = join(STORE_DIR, "skills.json");

export interface Skill {
  id: string;
  name: string;
  description: string;
  githubUrl: string;
  enabled: boolean;
  risk: "low" | "medium" | "high" | "unknown";
  riskNote: string;
  installed: boolean;
  curated: boolean;
  builtIn?: boolean; // true = ships with Claude Code, no SKILL.md download needed
}

export const CURATED_SKILLS: Skill[] = [
  // ── Workbot Core ────────────────────────────────────────────────────────
  {
    id: "brain-boot",
    name: "Brain Boot",
    description: "Mandatory session bootstrap. Loads brain context, checks agent reports, and enforces brain-first behavior every session.",
    githubUrl: "https://github.com/studiollama/workbot",
    enabled: true,
    risk: "low",
    riskNote: "Core workbot skill. Calls brain MCP tools (read-only bootstrap). No external network calls, no code execution.",
    installed: true,
    curated: true,
    builtIn: true,
  },
  // ── Official Anthropic Skills ──────────────────────────────────────────
  {
    id: "frontend-design",
    name: "Frontend Design",
    description: "Guides Claude to create distinctive, production-grade UI that avoids generic AI aesthetics. Forces bold design direction with precision execution.",
    githubUrl: "https://github.com/anthropics/skills",
    enabled: false,
    risk: "low",
    riskNote: "Official Anthropic skill. Markdown instructions only, no executable code.",
    installed: true,
    curated: true,
    builtIn: true,
  },
  {
    id: "webapp-testing",
    name: "Webapp Testing",
    description: "Guides Claude through testing web applications with end-to-end testing patterns, verification workflows, and browser automation.",
    githubUrl: "https://github.com/anthropics/skills",
    enabled: false,
    risk: "low",
    riskNote: "Official Anthropic skill. Ships with Claude Code.",
    installed: true,
    curated: true,
    builtIn: true,
  },
  {
    id: "pdf",
    name: "PDF",
    description: "Extract form fields, text, tables, and structured data from PDF files. Combine, split, rotate, watermark, and create PDFs.",
    githubUrl: "https://github.com/anthropics/skills",
    enabled: false,
    risk: "low",
    riskNote: "Official Anthropic skill. Ships with Claude Code.",
    installed: true,
    curated: true,
    builtIn: true,
  },
  {
    id: "skill-creator",
    name: "Skill Creator",
    description: "Meta-skill that helps create new skills. Generates SKILL.md structure, frontmatter, directory layout, and runs evals.",
    githubUrl: "https://github.com/anthropics/skills",
    enabled: false,
    risk: "low",
    riskNote: "Official Anthropic skill. Ships with Claude Code.",
    installed: true,
    curated: true,
    builtIn: true,
  },
  {
    id: "mcp-builder",
    name: "MCP Builder",
    description: "Guides Claude through building MCP (Model Context Protocol) servers from scratch, including tool definitions, transport setup, and testing.",
    githubUrl: "https://github.com/anthropics/skills",
    enabled: false,
    risk: "low",
    riskNote: "Official Anthropic skill. Ships with Claude Code.",
    installed: true,
    curated: true,
    builtIn: true,
  },
  {
    id: "code-review",
    name: "Code Review",
    description: "Automated PR review with parallel agents for CLAUDE.md compliance, bug detection, and git-blame context. Posts confidence-scored findings to GitHub.",
    githubUrl: "https://github.com/anthropics/claude-code",
    enabled: false,
    risk: "low",
    riskNote: "Official Anthropic plugin. Reads code, optionally posts PR comments via gh CLI. Does not modify source.",
    installed: true,
    curated: true,
    builtIn: true,
  },
  {
    id: "security-guidance",
    name: "Security Guidance",
    description: "Hook-based security monitor that watches for 9 vulnerability patterns (XSS, injection, eval, hardcoded secrets) and surfaces warnings during development.",
    githubUrl: "https://github.com/anthropics/claude-code",
    enabled: false,
    risk: "low",
    riskNote: "Official Anthropic plugin. Hook-only monitoring, no code modification, no external network calls.",
    installed: true,
    curated: true,
    builtIn: true,
  },
  // ── Platform Skills (Supabase / Vercel) ────────────────────────────────
  {
    id: "supabase-postgres",
    name: "Supabase Postgres",
    description: "Official Supabase skill for Postgres optimization across 8 categories: query performance, connection management, schema design, RLS policies, and monitoring.",
    githubUrl: "https://github.com/supabase/agent-skills",
    enabled: false,
    risk: "low",
    riskNote: "Official Supabase team skill. Pure guidance, no scripts or file writes.",
    installed: false,
    curated: true,
  },
  {
    id: "react-best-practices",
    name: "React Best Practices",
    description: "40+ rules from Vercel Engineering covering React performance: eliminating waterfalls, bundle optimization, rendering performance, and component patterns.",
    githubUrl: "https://github.com/vercel-labs/agent-skills",
    enabled: false,
    risk: "low",
    riskNote: "Official Vercel Labs skill. Instructional only, no scripts executed.",
    installed: false,
    curated: true,
  },
  {
    id: "web-design-guidelines",
    name: "Web Design Guidelines",
    description: "100+ rules covering accessibility (ARIA, focus states), UX patterns, forms, animations, typography, dark mode, and responsive design for Tailwind/CSS.",
    githubUrl: "https://github.com/vercel-labs/agent-skills",
    enabled: false,
    risk: "low",
    riskNote: "Official Vercel Labs skill. Pure guidance, no code execution.",
    installed: false,
    curated: true,
  },
  {
    id: "vercel-deploy",
    name: "Vercel Deploy",
    description: "Deploy and manage projects on Vercel directly from Claude Code. Configure environment variables, domains, and deployment settings.",
    githubUrl: "https://github.com/vercel/vercel-deploy-claude-code-plugin",
    enabled: false,
    risk: "medium",
    riskNote: "Official Vercel plugin. Deploys code to Vercel — review deployment targets before enabling.",
    installed: false,
    curated: true,
  },
  // ── Community Skills (Web Dev) ─────────────────────────────────────────
  {
    id: "superpowers",
    name: "Superpowers",
    description: "Complete agentic development framework with TDD workflow: brainstorm, spec, plan, implement (red-green-refactor), review, merge, and quality gates.",
    githubUrl: "https://github.com/obra/superpowers",
    enabled: false,
    risk: "low",
    riskNote: "42K+ stars, maintained by Jesse Vincent. Creates plan files in project dir, not in brain.",
    installed: false,
    curated: true,
  },
  {
    id: "agent-browser",
    name: "Agent Browser",
    description: "Headless browser automation CLI for AI agents. Uses ref-based element selection, reducing context consumption by 93%.",
    githubUrl: "https://github.com/vercel-labs/agent-browser",
    enabled: false,
    risk: "medium",
    riskNote: "Maintained by Vercel Labs. Executes browser automation commands — review before enabling.",
    installed: false,
    curated: true,
  },
  {
    id: "playwright",
    name: "Playwright Testing",
    description: "Write and execute Playwright browser automation and E2E tests autonomously. Progressive API reference loading to minimize context usage.",
    githubUrl: "https://github.com/lackeyjb/playwright-skill",
    enabled: false,
    risk: "medium",
    riskNote: "Community skill. Runs generated Playwright code with visible browser. Creates temp screenshots in /tmp/.",
    installed: false,
    curated: true,
  },
  {
    id: "trailofbits-security",
    name: "Trail of Bits Security",
    description: "40+ security skills from a leading security firm: static analysis (CodeQL/Semgrep), differential code review, supply chain risk auditing, and insecure defaults detection.",
    githubUrl: "https://github.com/trailofbits/skills",
    enabled: false,
    risk: "medium",
    riskNote: "Reputable security firm. Some skills invoke CodeQL/Semgrep (must be installed separately). No file modifications.",
    installed: false,
    curated: true,
  },
];

export function loadSkills(): Skill[] {
  try {
    if (!existsSync(SKILLS_PATH)) return CURATED_SKILLS.map((s) => ({ ...s }));
    const saved: Skill[] = JSON.parse(readFileSync(SKILLS_PATH, "utf-8"));

    // Merge: curated skills get metadata refreshed, user prefs (enabled/installed) preserved
    const savedById = new Map(saved.map((s) => [s.id, s]));
    const result: Skill[] = CURATED_SKILLS.map((curated) => {
      const userState = savedById.get(curated.id);
      if (userState) {
        return {
          ...curated,
          enabled: userState.enabled,
          installed: userState.installed,
        };
      }
      return { ...curated };
    });

    // Append user-added (non-curated) skills — skip old curated skills that were removed
    for (const s of saved) {
      if (!s.curated && !CURATED_SKILLS.some((c) => c.id === s.id)) {
        result.push(s);
      }
    }

    return result;
  } catch {
    return CURATED_SKILLS.map((s) => ({ ...s }));
  }
}

export function saveSkills(skills: Skill[]) {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(SKILLS_PATH, JSON.stringify(skills, null, 2));
}
