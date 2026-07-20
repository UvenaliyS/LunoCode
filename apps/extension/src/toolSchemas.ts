/**
 * Anthropic Messages API tool definitions — the REAL Claude Code CLI tool set.
 *
 * We send these with the exact CC names/schemas (captured from the official
 * client) so the gateway's Claude-Code impersonation lines up with its system
 * prompt, and the webview renders each tool with its proper icon/label. The
 * AgentRunner maps each name to a concrete workspace operation.
 */

export const TOOL_SCHEMAS = [
  {
    name: "Bash",
    description:
      "Executes a given bash command in the workspace and returns its combined stdout/stderr.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to execute" },
        description: {
          type: "string",
          description:
            "Clear, concise description of what this command does in active voice.",
        },
        timeout: {
          type: "number",
          description: "Optional timeout in milliseconds (max 600000).",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "Read",
    description: "Reads a file from the local filesystem. Returns its text.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The path to the file to read.",
        },
        offset: {
          type: "number",
          description: "The line number to start reading from.",
        },
        limit: { type: "number", description: "The number of lines to read." },
      },
      required: ["file_path"],
    },
  },
  {
    name: "Write",
    description:
      "Writes a file to the local filesystem, creating or overwriting it.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The path to the file to write.",
        },
        content: {
          type: "string",
          description: "The content to write to the file.",
        },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "Edit",
    description:
      "Performs an exact string replacement in a file. old_string must match exactly (including whitespace).",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The path to the file to modify.",
        },
        old_string: { type: "string", description: "The text to replace." },
        new_string: {
          type: "string",
          description: "The text to replace it with.",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences (default false).",
        },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  {
    name: "Glob",
    description:
      "Fast file pattern matching. Returns paths matching a glob like '**/*.ts' or 'src/**/*.tsx'.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The glob pattern to match files against.",
        },
        path: {
          type: "string",
          description: "The directory to search in (defaults to the workspace root).",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Grep",
    description:
      "Search file contents with a regular expression. Returns matching lines (or files).",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The regular expression to search for.",
        },
        path: {
          type: "string",
          description: "File or directory to search in (defaults to the workspace).",
        },
        glob: {
          type: "string",
          description: 'Glob to filter files, e.g. "*.ts".',
        },
        output_mode: {
          type: "string",
          description:
            '"content" (matching lines), "files_with_matches" (paths), or "count".',
        },
        "-i": { type: "boolean", description: "Case-insensitive search." },
        "-n": { type: "boolean", description: "Show line numbers." },
      },
      required: ["pattern"],
    },
  },
  {
    name: "LS",
    description:
      "List files and directories at a path. Returns one entry per line.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: 'Directory path (defaults to the workspace root).',
        },
      },
      required: [],
    },
  },
  {
    name: "TodoWrite",
    description:
      "Create and manage a structured task list for the current session, so the user can track progress on a multi-step task.",
    input_schema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The full todo list.",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "The task description." },
              status: {
                type: "string",
                description: '"pending", "in_progress", or "completed".',
              },
              activeForm: {
                type: "string",
                description: "Present-continuous form shown while in progress.",
              },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
  },
  {
    name: "AskUserQuestion",
    description:
      "Ask the user a question when you are blocked on a decision only they can make. Prefer proceeding with sensible defaults over asking.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "WebFetch",
    description:
      "Fetch a URL and return its content as text (HTML is converted to plain text). Use for reading documentation pages, APIs, and other public web resources.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The http/https URL to fetch." },
        prompt: {
          type: "string",
          description:
            "What to look for in the page — the tool returns the page text; do the analysis in your next step.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "WebSearch",
    description:
      "Search the web for up-to-date information and return relevant results.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
      },
      required: ["query"],
    },
  },
  {
    name: "sshList",
    description:
      "List the user's configured SSH servers (id, name, connection details). Credentials are never exposed.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "sshAdd",
    description:
      "Prompt the user to add a new SSH server. Opens an interactive form (name, host, user, auth method). Returns when the user confirms or cancels.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "sshPick",
    description:
      "Ask the user to pick which SSH server(s) to target. Opens an interactive picker. Use when a command could match more than one server.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Optional prompt shown above the picker.",
        },
        multi: {
          type: "boolean",
          description: "Allow selecting multiple servers.",
        },
      },
      required: [],
    },
  },
  {
    name: "sshExec",
    description:
      "Execute a command on one of the user's remote SSH servers and return its output.",
    input_schema: {
      type: "object",
      properties: {
        serverId: {
          type: "string",
          description: "Server id from sshList.",
        },
        command: {
          type: "string",
          description: "Command to execute remotely.",
        },
      },
      required: ["serverId", "command"],
    },
  },
] as const;

/**
 * OpenAI Chat Completions tool format: the same tools wrapped as
 * {type:"function", function:{name, description, parameters}}. Used by the
 * openai-v1 agentic path so any OpenAI-compatible provider gets the full
 * Claude-Code tool set with identical names (so AgentRunner executes them the
 * same way).
 */
export const OPENAI_TOOL_SCHEMAS = TOOL_SCHEMAS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

/**
 * OpenAI Responses (Codex) tool format: flat {type:"function", name,
 * description, parameters}. Same tool set + names as Claude Code.
 */
export const CODEX_TOOL_SCHEMAS = TOOL_SCHEMAS.map((t) => ({
  type: "function" as const,
  name: t.name,
  description: t.description,
  parameters: t.input_schema,
}));
