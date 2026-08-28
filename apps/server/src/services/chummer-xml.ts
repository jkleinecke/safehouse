/**
 * A tiny forgiving XML walker for the Chummer importer (FR3.1).
 *
 * No new dependency (BUILD_CONVENTIONS dependency budget) and no strictness:
 * unclosed tags, mismatched closes, stray `&`, CDATA, comments, doctypes and
 * unquoted attributes all parse to whatever structure can be recovered. A
 * half-written save should still yield the half it contains (Principle 5).
 *
 * Element names are lowercased (Chummer writes them that way); text is
 * entity-decoded and concatenated per node.
 */

export interface XmlNode {
  /** Lowercased element name ('#document' for the synthetic root). */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated direct text content, entity-decoded. */
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode the handful of entities a Chummer save can contain; leave the rest. */
export function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body.startsWith('#x') || body.startsWith('#X')
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Index of the '>' closing the tag opened at `from`, honoring quoted values. */
function tagEnd(src: string, from: number): number {
  let quote: string | null = null;
  for (let i = from + 1; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

const ATTR_RE = /([^\s=/]+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseTagBody(body: string): { name: string; attrs: Record<string, string> } {
  const trimmed = body.trim();
  const match = /^([^\s/>]+)/.exec(trimmed);
  const name = (match?.[1] ?? '').toLowerCase();
  const attrs: Record<string, string> = {};
  if (name.length === 0) return { name, attrs };
  const rest = trimmed.slice(name.length);
  ATTR_RE.lastIndex = 0;
  let attr: RegExpExecArray | null;
  while ((attr = ATTR_RE.exec(rest)) !== null) {
    const key = attr[1]?.toLowerCase();
    if (!key) continue;
    attrs[key] = decodeEntities(attr[3] ?? attr[4] ?? attr[5] ?? '');
  }
  return { name, attrs };
}

/**
 * Parse an XML document into a node tree. Never throws: malformed input yields
 * whatever structure could be recovered.
 */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const top = (): XmlNode => stack[stack.length - 1]!;
  const addText = (raw: string, decode = true): void => {
    if (raw.length === 0) return;
    top().text += decode ? decodeEntities(raw) : raw;
  };

  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      addText(src.slice(i));
      break;
    }
    if (lt > i) addText(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      addText(src.slice(lt + 9, end === -1 ? src.length : end), false);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    const gt = tagEnd(src, lt);
    if (gt === -1) {
      addText(src.slice(lt));
      break;
    }
    const raw = src.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (raw.length === 0) continue;

    if (raw.startsWith('/')) {
      const closing = raw.slice(1).trim().toLowerCase();
      for (let d = stack.length - 1; d > 0; d--) {
        if (stack[d]!.name === closing) {
          stack.length = d;
          break;
        }
      }
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const { name, attrs } = parseTagBody(selfClosing ? raw.slice(0, -1) : raw);
    if (name.length === 0) continue;
    const node: XmlNode = { name, attrs, children: [], text: '' };
    top().children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

/** Direct children named `name`. */
export function kids(node: XmlNode | undefined, name: string): XmlNode[] {
  if (!node) return [];
  const want = name.toLowerCase();
  return node.children.filter((c) => c.name === want);
}

/** First direct child named `name`. */
export function kid(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return kids(node, name)[0];
}

/** Trimmed text of `node` (or of its child `name`). */
export function txt(node: XmlNode | undefined, name?: string): string {
  const target = name ? kid(node, name) : node;
  return (target?.text ?? '').trim();
}

/** Leading number in `node`'s (or child `name`'s) text; `fallback` when absent. */
export function num(node: XmlNode | undefined, name?: string, fallback = 0): number {
  const raw = txt(node, name);
  const match = /-?\d+(?:\.\d+)?/.exec(raw);
  if (!match) return fallback;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Chummer writes True/False; also accept 1/yes. */
export function flag(node: XmlNode | undefined, name: string, fallback = false): boolean {
  const raw = txt(node, name).toLowerCase();
  if (raw.length === 0) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/** Every descendant named `name`, document order (depth-first). */
export function deepAll(node: XmlNode, name: string): XmlNode[] {
  const want = name.toLowerCase();
  const out: XmlNode[] = [];
  const walk = (n: XmlNode): void => {
    for (const c of n.children) {
      if (c.name === want) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** First descendant named `name`. */
export function deepFind(node: XmlNode, name: string): XmlNode | undefined {
  return deepAll(node, name)[0];
}
