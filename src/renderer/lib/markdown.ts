/**
 * 公告 Markdown 渲染（2026-10-05 主页模块）。
 *
 * 安全模型：**先整体 HTML 转义，再在转义结果上重建受限标记**——原始 HTML 一律不透传，
 * 链接/图片只接受 http(s) 地址。支持的子集：# 标题、**加粗**、*斜体*、`代码`、
 * [文字](链接)、![说明](图片)、- 列表、空行分段、行内换行。
 * 公告是管理员写给全员看的，但渲染端仍按不可信输入处理（纵深防御）。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 只放行 http(s) 与相对为空的地址；其余一律渲染成纯文本。 */
function safeUrl(raw: string): string | null {
  const url = raw.trim();
  return /^https:\/\//i.test(url) || /^http:\/\//i.test(url) ? url : null;
}

function attr(url: string): string {
  return safeUrl(url)?.replace(/"/g, '%22') ?? '';
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  // 图片：![说明](url) —— 说明转义后作 alt
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) => {
    const u = attr(url);
    return u ? `<img src="${u}" alt="${alt}" class="md-img" />` : alt;
  });
  // 链接：[文字](url) —— 新窗口打开
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    const u = attr(url);
    return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer" class="md-link">${label}</a>` : label;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  return out;
}

/** 渲染为受限 HTML 片段（配合 .md-body 的样式使用）。 */
export function renderMarkdown(src: string): string {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let listItems: string[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push('<ul class="md-ul">' + listItems.map((li) => `<li>${renderInline(li)}</li>`).join('') + '</ul>');
      listItems = [];
    }
  };
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p class="md-p">${paragraph.map(renderInline).join('<br />')}</p>`);
      paragraph = [];
    }
  };
  const flushQuote = () => {
    if (quote.length > 0) {
      blocks.push('<blockquote class="md-quote">' + quote.map(renderInline).join('<br />') + '</blockquote>');
      quote = [];
    }
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      flushParagraph();
      const level = heading[1].length;
      blocks.push(`<h${level + 2} class="md-h${level}">${renderInline(heading[2])}</h${level + 2}>`);
      continue;
    }
    // --- 或 *** = 分隔线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushList();
      flushParagraph();
      blocks.push('<hr class="md-hr" />');
      continue;
    }
    // > 引用块（连续行合并）
    if (/^>\s?/.test(line)) {
      flushList();
      flushParagraph();
      quote.push(line.replace(/^>\s?/, ''));
      continue;
    }
    if (/^-\s+/.test(line)) {
      flushParagraph();
      listItems.push(line.replace(/^-\s+/, ''));
      continue;
    }
    if (line.trim().length === 0) {
      flushList();
      flushQuote();
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushList();
  flushQuote();
  flushParagraph();
  return blocks.join('');
}
