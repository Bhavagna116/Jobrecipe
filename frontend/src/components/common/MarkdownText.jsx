import React from 'react';

/**
 * Lightweight, dependency-free Markdown renderer.
 *
 * The question bank stores problem statements as Markdown (headings, bold,
 * lists, code). Rendering that as plain text showed raw `###`/`**` markers.
 * This component converts the supported Markdown into React elements, so no
 * HTML is injected and no sanitizer is required.
 *
 * Supported: headings, bold, italic, inline code, fenced code blocks,
 * unordered/ordered lists, blockquotes, horizontal rules and paragraphs.
 */

const INLINE_RE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;

export const stripMarkdown = (value) =>
  String(value || '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

const renderInline = (text, dark) => {
  const nodes = [];
  const source = String(text || '');
  let lastIndex = 0;
  let key = 0;
  let match;

  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(source)) !== null) {
    if (match.index > lastIndex) nodes.push(source.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={`i-${key++}`} className="font-bold">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={`i-${key++}`}
          className={`px-1.5 py-0.5 rounded text-[0.9em] font-mono ${dark ? 'bg-zinc-800 text-emerald-300' : 'bg-slate-100 text-slate-800'}`}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(<em key={`i-${key++}`}>{token.slice(1, -1)}</em>);
    }
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < source.length) nodes.push(source.slice(lastIndex));
  return nodes;
};

const isBlockStart = (line) =>
  /^\s*(#{1,6})\s+/.test(line) ||
  /^\s*[-*+]\s+/.test(line) ||
  /^\s*\d+\.\s+/.test(line) ||
  /^\s*>\s?/.test(line) ||
  /^\s*```/.test(line) ||
  /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line);

export const MarkdownText = ({ text, className = '', dark = false }) => {
  if (text === undefined || text === null || text === '') return null;

  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;

  const headingClass = dark ? 'text-zinc-100' : 'text-slate-900';

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^\s*```/.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push(
        <pre
          key={`b-${key++}`}
          className={`text-xs font-mono p-3 rounded-lg overflow-x-auto ${dark ? 'bg-zinc-900 text-emerald-200 border border-zinc-800' : 'bg-slate-900 text-slate-100'}`}
        >
          <code>{code.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Heading
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      const Tag = `h${level}`;
      const sizes = ['text-lg', 'text-base', 'text-sm', 'text-sm'];
      blocks.push(
        <Tag
          key={`b-${key++}`}
          className={`${sizes[level - 1]} font-extrabold tracking-tight ${headingClass}`}
        >
          {renderInline(heading[2], dark)}
        </Tag>
      );
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push(<hr key={`b-${key++}`} className={dark ? 'border-zinc-800' : 'border-slate-200'} />);
      i += 1;
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={`b-${key++}`} className="list-disc pl-5 space-y-1">
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInline(item, dark)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ol key={`b-${key++}`} className="list-decimal pl-5 space-y-1">
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>{renderInline(item, dark)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`b-${key++}`}
          className={`border-l-4 pl-3 italic ${dark ? 'border-zinc-600 text-zinc-400' : 'border-slate-300 text-slate-600'}`}
        >
          {renderInline(quote.join(' '), dark)}
        </blockquote>
      );
      continue;
    }

    // Paragraph: keep consuming plain lines so intentional line breaks survive.
    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`b-${key++}`} className="whitespace-pre-line">
        {renderInline(paragraph.join('\n'), dark)}
      </p>
    );
  }

  return <div className={className}>{blocks}</div>;
};

export default MarkdownText;
