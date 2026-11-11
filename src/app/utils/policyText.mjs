function isPolicyHeading(line) {
  return /^(?:Terms and Conditions|Privacy Policy|Section \d+\.\s+.+)$/.test(line);
}

function isPolicySubheading(line) {
  return /^\d+(?:\.\d+)+\.?\s+\S/.test(line);
}

function isListItem(line) {
  return /^(?:[A-Z]|[a-z]|i{1,3}|iv|v|vi{0,3})\.\s|^(?:\u25cf|\u2022|\u25aa)\u200b?\s*/u.test(line);
}

export function formatPolicyContent(text) {
  const blocks = [];
  let lines = [];
  let kind = "paragraph";
  const flush = () => {
    const value = lines.join(" ").trim();
    if (value) blocks.push({ kind, value });
    lines = [];
    kind = "paragraph";
  };

  for (const rawLine of text.replaceAll("\f", "\n").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (isPolicyHeading(line) || isPolicySubheading(line) || isListItem(line)) {
      flush();
      kind = isPolicyHeading(line) ? "heading" : isPolicySubheading(line) ? "subheading" : "list";
      lines.push(line);
      flush();
      continue;
    }

    lines.push(line);
    if (/[.!?]["')\]]*$/.test(line)) flush();
  }
  flush();
  return blocks;
}
