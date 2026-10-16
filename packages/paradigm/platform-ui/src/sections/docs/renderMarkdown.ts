/**
 * Simple markdown rendering — basic subset for docs pages and Academy notes.
 *
 * SECURITY: the whole input is escaped (`& < >`) FIRST, before any tag is
 * emitted, and no attributes or links are ever built — so the output can only
 * contain the fixed tags below. React-free so it unit-tests in node.
 *
 * Supported: # / ## / ### headings, **bold**, `code`, fenced ``` code blocks
 * (content kept verbatim, no language attribute), `-`/`*` bullet lists,
 * `1.` numbered lists, blank-line separated paragraphs.
 */
export function renderMarkdown(md: string): string {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const lines = escaped.replace(/\r\n?/g, '\n').split('\n');

  const inline = (s: string): string => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  const FENCE = /^\s*```/;
  const UL = /^\s*[-*]\s+(.*)$/;
  const OL = /^\s*\d+\.\s+(.*)$/;
  const HEADING = /^(#{1,3}) (.+)$/;

  const out: string[] = [];
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length > 0) out.push(`<p>${inline(para.join('\n'))}</p>`);
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i++; // closing fence (or end of input)
      out.push(`<pre><code>${code.join('\n')}</code></pre>`);
      continue;
    }
    const list = UL.test(line) ? { re: UL, tag: 'ul' } : OL.test(line) ? { re: OL, tag: 'ol' } : null;
    if (list) {
      flushPara();
      const items: string[] = [];
      let m: RegExpExecArray | null;
      while (i < lines.length && (m = list.re.exec(lines[i]))) {
        items.push(`<li>${inline(m[1])}</li>`);
        i++;
      }
      out.push(`<${list.tag}>${items.join('')}</${list.tag}>`);
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (line.trim() === '') {
      flushPara();
    } else {
      para.push(line);
    }
    i++;
  }
  flushPara();
  return out.join('');
}
