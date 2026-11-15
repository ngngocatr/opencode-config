const DEFAULT_MAX_WIDTH = 36;

function textWidth(value) {
  return [...value].length;
}

function fitRow(label, value, maxWidth = DEFAULT_MAX_WIDTH) {
  const gap = Math.max(1, maxWidth - textWidth(label) - textWidth(value));
  return `${label}${" ".repeat(gap)}${value}`;
}

function localizeCountdown(value) {
  return value
    .replace(/^(\d+(?:\.\d+)?)d$/, "$1 ngày")
    .replace(/^(\d{1,2})h:(\d{2})m$/, "$1g:$2p")
    .replace(/^reset$/i, "đặt lại");
}

const ROW_LABELS = new Map([
  ["Five-hour", "Hạn mức 5 giờ"],
  ["Weekly", "Hạn mức tuần"],
  ["Daily allowance", "Hạn mức/ngày"],
  ["Reset", "Đặt lại hạn mức"],
]);

export function localizeQuotaDisplayLine(line, maxWidth = DEFAULT_MAX_WIDTH) {
  if (!line) return line;
  const exact = {
    "Loading…": "Đang tải…",
    Unavailable: "Không khả dụng",
    "Quota loading…": "Đang tải hạn mức…",
    "Quota unavailable": "Hạn mức không khả dụng",
  }[line];
  if (exact) return exact;

  const bar = line.match(/^([█░]+)\s+(\d+(?:\.\d+)?%)\s+(left|used)$/i);
  if (bar) {
    const value = bar[3].toLowerCase() === "used" ? `đã dùng ${bar[2]}` : `còn ${bar[2]}`;
    return fitRow(bar[1], value, maxWidth);
  }

  for (const [source, translated] of ROW_LABELS) {
    const match = line.match(new RegExp(`^${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(.+)$`, "i"));
    if (match) return fitRow(translated, localizeCountdown(match[1].trim()), maxWidth);
  }

  return line
    .replace(/(\d+(?:\.\d+)?%)\s+left\b/gi, "còn $1")
    .replace(/(\d+(?:\.\d+)?%)\s+used\b/gi, "đã dùng $1")
    .replace(/\bFive-hour\b/g, "Hạn mức 5 giờ")
    .replace(/\bQuota unavailable\b/g, "Hạn mức không khả dụng")
    .replace(/\bLoading…\b/g, "Đang tải…");
}

export function localizeQuotaDisplayText(text, maxWidth = DEFAULT_MAX_WIDTH) {
  return text
    .split("\n")
    .map((line) => localizeQuotaDisplayLine(line, maxWidth))
    .join("\n");
}

export function getQuotaLineColor(line, theme) {
  if (/còn\s+\d+(?:\.\d+)?%/i.test(line)) {
    const match = line.match(/(\d+(?:\.\d+)?)%/);
    const percent = match ? Number(match[1]) : 100;
    if (percent <= 18) return theme.error;
    if (percent <= 30) return theme.warning;
    return theme.success;
  }
  if (/Hạn mức 5 giờ|Hạn mức tuần|Weekly|Five-hour/i.test(line)) return theme.text;
  return theme.textMuted;
}
