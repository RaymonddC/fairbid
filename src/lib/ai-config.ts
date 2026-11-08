// The Claude model for the AI roles. A setting, not a constant, because model
// names are retired: change ANTHROPIC_MODEL, not the code. Server only.

export const DEFAULT_MODEL = "claude-opus-5-5";

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}
