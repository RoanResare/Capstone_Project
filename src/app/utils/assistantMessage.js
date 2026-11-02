const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function parseTableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function isTableRow(line) {
  return (line.match(/(?<!\\)\|/g) || []).length >= 1;
}

function isListItem(line) {
  return /^\s*(?:[-+*]|\d+[.)])\s+/.test(line);
}

function makeTableBlock(lines) {
  let rows = lines.map(parseTableCells);
  if (rows.length > 1 && TABLE_SEPARATOR.test(lines[1])) rows = [rows[0], ...rows.slice(2)];
  const headers = rows[0] || [];
  return {
    type: "table",
    rows: rows.slice(1).filter((row) => row.some(Boolean)).map((row) => ({
      title: row[0] || "Details",
      details: row.slice(1).flatMap((value, index) => value ? [{ label: headers[index + 1] || "", value }] : []),
    })),
  };
}

export function parseAssistantMessage(value = "") {
  const lines = String(value).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let listType = "ul";

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: listType, items: list });
    list = [];
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (isTableRow(line)) {
      flushParagraph();
      flushList();
      const tableLines = [];
      while (index < lines.length && isTableRow(lines[index])) tableLines.push(lines[index++]);
      blocks.push(makeTableBlock(tableLines));
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      index++;
      continue;
    }
    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      flushParagraph();
      flushList();
      index++;
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      index++;
      continue;
    }
    if (isListItem(line)) {
      flushParagraph();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const nextType = ordered ? "ol" : "ul";
      if (list.length && listType !== nextType) flushList();
      listType = nextType;
      list.push(line.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "").trim());
      index++;
      continue;
    }
    flushList();
    paragraph.push(line.trim());
    index++;
  }

  flushParagraph();
  flushList();
  return blocks;
}
