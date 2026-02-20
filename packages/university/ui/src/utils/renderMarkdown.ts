/** Apply inline markdown (bold, italic, code) to text */
function inlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Parse a markdown table block into HTML */
function parseTable(block: string): string {
  const lines = block.trim().split('\n');
  if (lines.length < 2) return block;

  const parseRow = (line: string) =>
    line.split('|').map(c => c.trim()).filter(c => c.length > 0);

  const headers = parseRow(lines[0]);
  // lines[1] is the separator (|---|---|)
  const rows = lines.slice(2).map(parseRow);

  let html = '<table><thead><tr>';
  for (const h of headers) html += `<th>${inlineMarkdown(h)}</th>`;
  html += '</tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr>';
    for (const cell of row) html += `<td>${inlineMarkdown(cell)}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

/** Minimal markdown-to-HTML renderer (handles ##, **, `, ```, -, |, tables, ordered lists) */
export function renderMarkdown(md: string): string {
  // Extract code blocks first to protect them from paragraph processing
  const preserved: string[] = [];
  let html = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const idx = preserved.length;
    preserved.push(`<pre><code>${code}</code></pre>`);
    return `\x00BLOCK${idx}\x00`;
  });

  // Extract tables (consecutive lines starting with |)
  html = html.replace(/((?:^\|.+\|\n?)+)/gm, (tableBlock) => {
    const lines = tableBlock.trim().split('\n');
    // Need at least header + separator + 1 row, and line 2 must be separator
    if (lines.length >= 3 && /^[\s-:|]+$/.test(lines[1])) {
      const idx = preserved.length;
      preserved.push(parseTable(tableBlock));
      return `\x00BLOCK${idx}\x00`;
    }
    return tableBlock;
  });

  html = html
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Ordered lists (1. item, 2. item)
    .replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>')
    // Wrap consecutive <oli> in <ol>
    .replace(/((?:<oli>.*<\/oli>\n?)+)/g, (m) => '<ol>' + m.replace(/<\/?oli>/g, (t) => t.replace('oli', 'li')) + '</ol>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
    // Paragraphs (lines not already wrapped in block-level tags)
    .replace(/^(?!<(?:h[1-6]|ul|ol|li|p|blockquote|pre|table|thead|tbody|tr|td|th|\x00)).+$/gm, '<p>$&</p>')
    // Clean up extra newlines
    .replace(/\n{2,}/g, '\n');

  // Restore preserved blocks (code + tables)
  html = html.replace(/\x00BLOCK(\d+)\x00/g, (_m, idx) => preserved[Number(idx)]);

  return html;
}
