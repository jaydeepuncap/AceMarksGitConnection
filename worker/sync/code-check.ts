/**
 * Code check run before files reach Shopify ("Error check" in the client guide).
 *
 *   .json   – must parse as JSON. Shopify allows comments in theme JSON files
 *             (it writes a /* … *\/ header into templates), so comments are
 *             removed first.
 *   .liquid – tags and output must be closed, block tags (if/for/case/…) must be
 *             balanced and nested correctly, raw blocks must end, and
 *             {% schema %} must contain valid JSON.
 *
 * The check is deliberately conservative: it only reports problems that would
 * make Shopify reject the file or break rendering, so a clean file is never
 * blocked.
 */
import type { CodeIssue } from '../../shared/api-types';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

/** Tags whose content is not parsed as Liquid. */
const RAW_TAGS = new Set(['raw', 'comment', 'schema', 'javascript', 'stylesheet', 'doc']);
/** Tags that need a matching {% end… %}. */
const BLOCK_TAGS = new Set(['if', 'unless', 'case', 'for', 'tablerow', 'capture', 'form', 'paginate', 'style', 'ifchanged']);

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Removes // and /* *\/ comments outside of strings (keeps newlines so line numbers stay right). */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i++;
      }
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

function jsonIssue(path: string, text: string, err: unknown, lineOffset = 0): CodeIssue {
  const message = err instanceof Error ? err.message : String(err);
  const position = /position (\d+)/.exec(message);
  const lineMatch = /line (\d+)/.exec(message);
  const line = position ? lineAt(text, Number(position[1])) : lineMatch ? Number(lineMatch[1]) : null;
  return {
    path,
    line: line === null ? null : line + lineOffset,
    message: `Invalid JSON: ${message.replace(/^JSON\.parse: /, '')}`,
  };
}

export function checkJson(path: string, text: string, lineOffset = 0): CodeIssue[] {
  const stripped = stripJsonComments(text.replace(/^\uFEFF/, ''));
  if (stripped.trim() === '') return [{ path, line: null, message: 'File is empty; Shopify expects JSON' }];
  try {
    JSON.parse(stripped);
    return [];
  } catch (err) {
    return [jsonIssue(path, stripped, err, lineOffset)];
  }
}

interface OpenBlock {
  name: string;
  line: number;
}

function tagName(inner: string): { name: string; markup: string } {
  const trimmed = inner.trim();
  if (trimmed.startsWith('#')) return { name: '#', markup: '' };
  const match = /^([A-Za-z_][\w-]*)([\s\S]*)$/.exec(trimmed);
  return match ? { name: match[1]!, markup: match[2]! } : { name: trimmed, markup: '' };
}

class BlockStack {
  readonly stack: OpenBlock[] = [];
  constructor(
    private readonly path: string,
    private readonly issues: CodeIssue[],
  ) {}

  handle(name: string, line: number): void {
    if (BLOCK_TAGS.has(name)) {
      this.stack.push({ name, line });
      return;
    }
    const top = this.stack[this.stack.length - 1];
    if (name === 'elsif' && !(top && (top.name === 'if' || top.name === 'unless'))) {
      this.issues.push({ path: this.path, line, message: '{% elsif %} is outside an {% if %} block' });
    } else if (name === 'when' && top?.name !== 'case') {
      this.issues.push({ path: this.path, line, message: '{% when %} is outside a {% case %} block' });
    } else if (name === 'else' && !(top && ['if', 'unless', 'case', 'for'].includes(top.name))) {
      this.issues.push({ path: this.path, line, message: '{% else %} is outside an if, unless, case or for block' });
    } else if (name.startsWith('end') && BLOCK_TAGS.has(name.slice(3))) {
      const opened = name.slice(3);
      if (!top) {
        this.issues.push({ path: this.path, line, message: `{% ${name} %} has no matching {% ${opened} %}` });
      } else if (top.name !== opened) {
        this.issues.push({
          path: this.path,
          line,
          message: `{% ${name} %} found, but {% ${top.name} %} from line ${top.line} is still open`,
        });
        // Recover: close up to the matching block if there is one.
        const index = this.stack.map((b) => b.name).lastIndexOf(opened);
        if (index >= 0) this.stack.length = index;
      } else {
        this.stack.pop();
      }
    }
  }

  finish(): void {
    for (const open of this.stack) {
      this.issues.push({ path: this.path, line: open.line, message: `{% ${open.name} %} is never closed with {% end${open.name} %}` });
    }
  }
}

/** Statements inside {% liquid %}: one tag per line, `#` comments, comment blocks. */
function checkLiquidTag(markup: string, startLine: number, blocks: BlockStack): void {
  let inComment = false;
  markup.split('\n').forEach((raw, i) => {
    const line = startLine + i;
    const { name } = tagName(raw);
    if (!raw.trim() || name === '#') return;
    if (inComment) {
      if (name === 'endcomment') inComment = false;
      return;
    }
    if (name === 'comment') {
      inComment = true;
      return;
    }
    blocks.handle(name, line);
  });
}

export function checkLiquid(path: string, text: string): CodeIssue[] {
  const issues: CodeIssue[] = [];
  const blocks = new BlockStack(path, issues);
  let i = 0;
  while (i < text.length) {
    const tagStart = text.indexOf('{%', i);
    const outputStart = text.indexOf('{{', i);
    if (tagStart < 0 && outputStart < 0) break;

    if (outputStart >= 0 && (tagStart < 0 || outputStart < tagStart)) {
      const end = text.indexOf('}}', outputStart + 2);
      if (end < 0) {
        issues.push({ path, line: lineAt(text, outputStart), message: 'Output {{ is never closed with }}' });
        break;
      }
      i = end + 2;
      continue;
    }

    const end = text.indexOf('%}', tagStart + 2);
    const line = lineAt(text, tagStart);
    if (end < 0) {
      issues.push({ path, line, message: 'Tag {% is never closed with %}' });
      break;
    }
    const inner = text.slice(tagStart + 2, end).replace(/^-/, '').replace(/-$/, '');
    const { name, markup } = tagName(inner);
    i = end + 2;

    if (RAW_TAGS.has(name)) {
      const closer = new RegExp(`\\{%-?\\s*end${name}\\s*-?%\\}`, 'g');
      closer.lastIndex = i;
      const match = closer.exec(text);
      if (!match) {
        issues.push({ path, line, message: `{% ${name} %} is never closed with {% end${name} %}` });
        break;
      }
      if (name === 'schema') {
        issues.push(...checkJson(path, text.slice(i, match.index), lineAt(text, i) - 1).map((issue) => ({
          ...issue,
          message: issue.message.replace('Invalid JSON', 'Invalid JSON in {% schema %}'),
        })));
      }
      i = match.index + match[0].length;
      continue;
    }
    if (name === 'liquid') {
      checkLiquidTag(markup, line, blocks);
      continue;
    }
    blocks.handle(name, line);
  }
  blocks.finish();
  return issues;
}

/** Returns the problems found in one theme file (empty when it is fine or not a code file). */
export function checkThemeFile(path: string, bytes: Uint8Array): CodeIssue[] {
  const isLiquid = path.endsWith('.liquid');
  const isJson = path.endsWith('.json');
  if (!isLiquid && !isJson) return [];
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return [{ path, line: null, message: 'File is not valid UTF-8 text' }];
  }
  return isJson ? checkJson(path, text) : checkLiquid(path, text);
}

export function isCheckedFile(path: string): boolean {
  return path.endsWith('.liquid') || path.endsWith('.json');
}
