// Inline SVG icons (lucide-style, 16px viewBox 24, stroke 1.75).
// Self-contained: no icon font, no network.

function svg(paths: string, viewBox = '0 0 24 24'): string {
  return `<svg width="16" height="16" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

export const icons = {
  bold: svg('<path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/>'),
  italic: svg('<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>'),
  underline: svg('<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" y1="20" x2="20" y2="20"/>'),
  strike: svg('<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>'),
  code: svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  unlink: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="3" y1="3" x2="21" y2="21"/>'),
  externalLink: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
  text: svg('<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>'),
  h1: svg('<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/>'),
  h2: svg('<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/>'),
  h3: svg('<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/>'),
  bulletList: svg('<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="0.5" fill="currentColor"/><circle cx="4.5" cy="12" r="0.5" fill="currentColor"/><circle cx="4.5" cy="18" r="0.5" fill="currentColor"/>'),
  orderedList: svg('<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
  taskList: svg('<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m4.5 8 1 1 2-2.5"/><line x1="13" y1="8" x2="21" y2="8"/><line x1="13" y1="16" x2="21" y2="16"/><rect x="3" y="13" width="6" height="6" rx="1"/>'),
  quote: svg('<path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/>'),
  codeBlock: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m9 10-2 2 2 2"/><path d="m15 10 2 2-2 2"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="1.5"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="10" y1="4" x2="10" y2="20"/>'),
  math: svg('<path d="M5 5h14"/><path d="M5 5l7 7-7 7h14"/>', '0 0 24 24'),
  divider: svg('<line x1="3" y1="12" x2="21" y2="12"/><circle cx="12" cy="6" r="0.5" fill="currentColor"/><circle cx="12" cy="18" r="0.5" fill="currentColor"/>'),
  paragraph: svg('<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>'),
  trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  check: svg('<polyline points="20 6 9 17 4 12"/>'),
  chevronDown: svg('<polyline points="6 9 12 15 18 9"/>'),
  search: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  close: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  arrowUp: svg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'),
  arrowDown: svg('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'),
  pencil: svg('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>'),
  rowAbove: svg('<rect x="3" y="13" width="18" height="8" rx="1.5"/><path d="M12 9V3"/><path d="m9 6 3-3 3 3"/>'),
  rowBelow: svg('<rect x="3" y="3" width="18" height="8" rx="1.5"/><path d="M12 15v6"/><path d="m9 18 3 3 3-3"/>'),
  colBefore: svg('<rect x="13" y="3" width="8" height="18" rx="1.5"/><path d="M9 12H3"/><path d="m6 9-3 3 3 3"/>'),
  colAfter: svg('<rect x="3" y="3" width="8" height="18" rx="1.5"/><path d="M15 12h6"/><path d="m18 9 3 3-3 3"/>'),
  headerRow: svg('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18"/><path d="M3 4h18v6H3z" fill="currentColor" stroke="none" opacity="0.3"/>'),
  rowDelete: svg('<rect x="3" y="9" width="12" height="6" rx="1.5"/><circle cx="19.5" cy="12" r="3.4"/><line x1="17.8" y1="12" x2="21.2" y2="12"/>'),
  colDelete: svg('<rect x="9" y="3" width="6" height="12" rx="1.5"/><circle cx="12" cy="19.5" r="3.4"/><line x1="10.3" y1="19.5" x2="13.7" y2="19.5"/>'),
}

export type IconName = keyof typeof icons
