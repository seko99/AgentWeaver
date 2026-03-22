import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

type MarkdownToken = {
  type: string;
  tag: string;
  content: string;
  info?: string;
  children?: MarkdownToken[];
  attrGet: (name: string) => string | null;
};

function wrapText(text: string, width = 88, indent = ""): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [indent];
  }

  const lines: string[] = [];
  let current = indent;

  for (const word of words) {
    const candidate = current.trim() ? `${current} ${word}` : `${indent}${word}`;
    if (candidate.length > width && current.trim()) {
      lines.push(current);
      current = `${indent}${word}`;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }
  return lines;
}

function renderInline(tokens: MarkdownToken[] | null | undefined): string {
  if (!tokens) {
    return "";
  }

  let result = "";
  let linkHref = "";

  for (const token of tokens) {
    switch (token.type) {
      case "text":
        result += token.content;
        break;
      case "code_inline":
        result += `\`${token.content}\``;
        break;
      case "softbreak":
      case "hardbreak":
        result += "\n";
        break;
      case "strong_open":
      case "strong_close":
        result += "*";
        break;
      case "em_open":
      case "em_close":
        result += "_";
        break;
      case "link_open":
        linkHref = token.attrGet("href") ?? "";
        break;
      case "link_close":
        if (linkHref) {
          result += ` (${linkHref})`;
          linkHref = "";
        }
        break;
      case "image":
        result += `[image: ${token.content || token.attrGet("src") || ""}]`;
        break;
      default:
        if (token.content) {
          result += token.content;
        }
        break;
    }
  }

  return result;
}

export function renderMarkdownToTerminal(markdown: string, width = 88): string {
  const tokens = md.parse(markdown, {});
  const lines: string[] = [];
  let bulletDepth = 0;
  let orderedDepth = 0;
  let orderedIndex = 1;
  let inBlockQuote = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previousType = tokens[index - 1]?.type ?? "";
    const previousPreviousType = tokens[index - 2]?.type ?? "";

    switch (token.type) {
      case "heading_open": {
        const inlineToken = tokens[index + 1];
        const level = Number.parseInt(token.tag.replace("h", ""), 10);
        const text = renderInline(inlineToken?.children).trim();
        if (lines.length > 0) {
          lines.push("");
        }
        const prefix = "#".repeat(Number.isNaN(level) ? 1 : level);
        lines.push(`${prefix} ${text}`);
        lines.push("");
        break;
      }
      case "paragraph_open":
        break;
      case "inline": {
        const isListItemInline =
          previousType === "list_item_open" ||
          (previousType === "paragraph_open" && previousPreviousType === "list_item_open");

        if (isListItemInline) {
          const baseIndent = "  ".repeat(Math.max(bulletDepth, orderedDepth) - 1);
          const prefix = bulletDepth > 0 ? "• " : `${orderedIndex}. `;
          const contentLines = wrapText(renderInline(token.children).trim(), width, `${baseIndent}${prefix}`);
          lines.push(...contentLines);
          if (orderedDepth > 0) {
            orderedIndex += 1;
          }
          break;
        }
        const next = tokens[index + 1]?.type ?? "";
        if (previousType === "heading_open" || previousType === "bullet_list_open" || previousType === "ordered_list_open") {
          break;
        }
        const text = renderInline(token.children).trim();
        if (!text) {
          break;
        }
        const indent = inBlockQuote ? "> " : "";
        lines.push(...wrapText(text, width, indent));
        if (next === "paragraph_close") {
          lines.push("");
        }
        break;
      }
      case "bullet_list_open":
        bulletDepth += 1;
        break;
      case "bullet_list_close":
        bulletDepth = Math.max(0, bulletDepth - 1);
        lines.push("");
        break;
      case "ordered_list_open":
        orderedDepth += 1;
        orderedIndex = Number.parseInt(token.attrGet("start") ?? "1", 10) || 1;
        break;
      case "ordered_list_close":
        orderedDepth = Math.max(0, orderedDepth - 1);
        orderedIndex = 1;
        lines.push("");
        break;
      case "list_item_open":
        break;
      case "list_item_close":
        break;
      case "blockquote_open":
        inBlockQuote = true;
        break;
      case "blockquote_close":
        inBlockQuote = false;
        lines.push("");
        break;
      case "fence":
      case "code_block": {
        if (lines.length > 0 && lines[lines.length - 1] !== "") {
          lines.push("");
        }
        const language = token.info?.trim();
        lines.push(language ? `\`\`\` ${language}` : "```");
        lines.push(...token.content.replace(/\n$/, "").split("\n"));
        lines.push("```");
        lines.push("");
        break;
      }
      case "hr":
        lines.push("─".repeat(Math.min(width, 40)));
        lines.push("");
        break;
      case "paragraph_close":
        break;
      default:
        break;
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
