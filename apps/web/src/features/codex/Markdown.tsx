/**
 * Codex markdown renderer (FR5.1/5.3, FR11.4).
 *
 * Two inline forms carry the campaign: `[[Wiki-links]]` become real navigation
 * (or a create-prompt when nothing answers to that title), and `SR5 p.426`
 * becomes a ref chip that opens the GM's own PDF at that printed page — the
 * same `RefChip` the sheet uses, so a page reference behaves identically
 * wherever it appears.
 *
 * Headings carry their section id as an anchor so the GM's reveal controls can
 * scroll to what they are about to show the table.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RefChip } from '../gm/books/RefChip.js';
import { parseMarkdown, type Block, type Inline } from './md.js';

export interface MarkdownProps {
  md: string;
  campaignId: string;
  /** Title → page id, for `[[links]]` that resolve (server-filtered list). */
  resolve?: (target: string) => string | null;
  /** Offered on an unresolved link — GM only; players just see plain text. */
  onCreate?: (target: string) => void;
}

function InlineRun({
  items,
  campaignId,
  resolve,
  onCreate,
}: {
  items: Inline[];
  campaignId: string;
  resolve?: (target: string) => string | null;
  onCreate?: (target: string) => void;
}) {
  return (
    <>
      {items.map((token, i) => {
        switch (token.kind) {
          case 'strong':
            return (
              <strong key={i} className="font-semibold text-ink">
                {token.text}
              </strong>
            );
          case 'em':
            return (
              <em key={i} className="italic">
                {token.text}
              </em>
            );
          case 'code':
            return (
              <code key={i} className="rounded bg-deck px-1 py-0.5 font-label text-xs text-cyan">
                {token.text}
              </code>
            );
          case 'ref':
            return <RefChip key={i} refValue={{ book: token.book, page: token.page }} />;
          case 'wikilink': {
            const pageId = resolve?.(token.target) ?? null;
            if (pageId) {
              return (
                <Link
                  key={i}
                  to={`/c/${campaignId}/codex/${pageId}`}
                  className="text-cyan underline decoration-cyan-dim underline-offset-2 hover:decoration-cyan"
                >
                  {token.label}
                </Link>
              );
            }
            if (onCreate) {
              return (
                <button
                  key={i}
                  type="button"
                  className="text-magenta underline decoration-dotted underline-offset-2 hover:text-cyan"
                  title={`No page called “${token.target}” yet — create it`}
                  onClick={() => onCreate(token.target)}
                >
                  {token.label}
                  <span aria-hidden> +</span>
                </button>
              );
            }
            return (
              <span key={i} className="text-dim" title="Not in the codex">
                {token.label}
              </span>
            );
          }
          default:
            return <span key={i}>{token.text}</span>;
        }
      })}
    </>
  );
}

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-6 text-lg font-semibold text-ink',
  2: 'mt-5 text-base font-semibold text-ink',
  3: 'mt-4 text-sm font-semibold text-ink',
};

function BlockView({
  block,
  campaignId,
  resolve,
  onCreate,
}: {
  block: Block;
  campaignId: string;
  resolve?: (target: string) => string | null;
  onCreate?: (target: string) => void;
}): ReactNode {
  const run = (items: Inline[]) => (
    <InlineRun items={items} campaignId={campaignId} resolve={resolve} onCreate={onCreate} />
  );

  switch (block.kind) {
    case 'heading':
      // `role`/`aria-level` rather than a dynamic h1–h6 tag: the page's own
      // title is the h1, so a codex `#` is a level-2 heading inside it.
      return (
        <div
          id={`section-${block.id}`}
          role="heading"
          aria-level={Math.min(block.level + 1, 6)}
          className={HEADING_CLASS[Math.min(block.level, 3)] ?? HEADING_CLASS[3]}
        >
          {run(block.inline)}
        </div>
      );
    case 'paragraph':
      return <p className="mt-3 text-sm leading-relaxed text-dim">{run(block.inline)}</p>;
    case 'quote':
      return (
        <blockquote className="mt-3 border-l-2 border-cyan-dim pl-3 text-sm italic text-dim">
          {run(block.inline)}
        </blockquote>
      );
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i} className="text-sm leading-relaxed text-dim">
          {run(item)}
        </li>
      ));
      return block.ordered ? (
        <ol className="mt-3 list-decimal space-y-1 pl-5 marker:text-faint">{items}</ol>
      ) : (
        <ul className="mt-3 list-disc space-y-1 pl-5 marker:text-faint">{items}</ul>
      );
    }
    case 'code':
      return (
        <pre className="mt-3 overflow-x-auto rounded-md border border-edge bg-deck p-3 font-label text-xs text-dim">
          {block.text}
        </pre>
      );
    case 'rule':
      return <hr className="mt-4 border-edge" />;
    default:
      return null;
  }
}

export default function Markdown({ md, campaignId, resolve, onCreate }: MarkdownProps) {
  const blocks = parseMarkdown(md);
  if (blocks.length === 0) {
    return <p className="mt-3 text-sm text-faint">This page has no content yet.</p>;
  }
  return (
    <div className="max-w-2xl">
      {blocks.map((block, i) => (
        <BlockView
          key={i}
          block={block}
          campaignId={campaignId}
          resolve={resolve}
          onCreate={onCreate}
        />
      ))}
    </div>
  );
}
