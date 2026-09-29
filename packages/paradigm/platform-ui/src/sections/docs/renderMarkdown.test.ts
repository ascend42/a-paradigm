import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './renderMarkdown';

describe('renderMarkdown', () => {
  it('renders headings, paragraphs, bold and inline code', () => {
    expect(renderMarkdown('# Title\n\nSome **bold** and `code`.\n\nNext para'))
      .toBe('<h1>Title</h1><p>Some <strong>bold</strong> and <code>code</code>.</p><p>Next para</p>');
  });

  it('renders fenced code blocks verbatim with no language attribute', () => {
    const html = renderMarkdown('Intro\n```ts\nconst a = 1;\n**not bold**\n```\nAfter');
    expect(html).toBe('<p>Intro</p><pre><code>const a = 1;\n**not bold**</code></pre><p>After</p>');
    expect(html).not.toContain('class=');
  });

  it('keeps <script> inside a code block escaped', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
    expect(html).toBe('<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>');
    expect(html).not.toContain('<script');
  });

  it('escapes raw HTML everywhere and never emits attributes', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>\n\n- <b>x</b>');
    expect(html).not.toMatch(/<img|<b>/);
    expect(html).not.toMatch(/<[a-z0-9]+\s[^>]*>/i);
  });

  it('renders bullet (- and *) and numbered lists', () => {
    expect(renderMarkdown('- one\n* two\n\n1. first\n2. **second**'))
      .toBe('<ul><li>one</li><li>two</li></ul><ol><li>first</li><li><strong>second</strong></li></ol>');
  });

  it('an unclosed fence runs to the end of input', () => {
    expect(renderMarkdown('```\nx')).toBe('<pre><code>x</code></pre>');
  });
});
