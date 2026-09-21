export interface MarkdownHeading {
  level: number;
  text: string;
  id: string;
}

export const slugifyHeading = (text: string) => text
  .toLowerCase()
  .replace(/\s+/g, '-')
  .replace(/[^\w\u4e00-\u9fa5-]/g, '');

export const extractHeadings = (markdownText: string): MarkdownHeading[] => {
  const headings: MarkdownHeading[] = [];
  const headingPattern = /^(#{1,6})\s+(.*)$/gm;
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(markdownText)) !== null) {
    const text = match[2].trim().replace(/[*_~`]/g, '');
    headings.push({ level: match[1].length, text, id: slugifyHeading(text) });
  }

  return headings;
};
