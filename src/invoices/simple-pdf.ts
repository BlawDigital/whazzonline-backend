/**
 * A tiny dependency-free PDF writer for text documents such as receipts.
 * It uses the built-in Helvetica fonts, so text is limited to Latin-1;
 * anything else is replaced with "?" and the naira sign is written as "NGN".
 */
export type PdfLine = {
  text: string;
  bold?: boolean;
  size?: number;
  gap?: number; // extra space before the line
};

const PAGE_WIDTH = 595; // A4 in points
const PAGE_HEIGHT = 842;
const MARGIN = 50;

export function pdfSafe(value: string) {
  return value
    .replaceAll('₦', 'NGN ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}
function escapePdf(value: string) {
  return pdfSafe(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}
/** Rough Helvetica width so long lines wrap inside the margins. */
function wrap(text: string, size: number) {
  const maxChars = Math.floor((PAGE_WIDTH - MARGIN * 2) / (size * 0.52));
  const words = pdfSafe(text).split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    let w = word;
    while (w.length > maxChars) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!current) current = w;
    else if ((current + ' ' + w).length <= maxChars) current += ' ' + w;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current || !lines.length) lines.push(current);
  return lines;
}

export function buildPdf(lines: PdfLine[]): Buffer {
  const pages: string[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const size = line.size ?? 10;
    const font = line.bold ? 'F2' : 'F1';
    y -= line.gap ?? 0;
    for (const piece of wrap(line.text, size)) {
      const leading = size * 1.45;
      if (y - leading < MARGIN) {
        pages.push([]);
        y = PAGE_HEIGHT - MARGIN;
      }
      y -= leading;
      pages[pages.length - 1].push(
        `BT /${font} ${size} Tf ${MARGIN} ${y.toFixed(2)} Td (${escapePdf(piece)}) Tj ET`,
      );
    }
  }

  // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold,
  // then a (page, content) pair per page.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((commands, i) => {
    const pageId = 5 + i * 2;
    const stream = commands.join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++)
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
