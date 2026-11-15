import type { RGBA } from "@opentui/core";
export declare function localizeQuotaDisplayLine(line: string, maxWidth?: number): string;
export declare function localizeQuotaDisplayText(text: string, maxWidth?: number): string;
export declare function getQuotaLineColor(line: string, theme: { error: RGBA; warning: RGBA; success: RGBA; text: RGBA; textMuted: RGBA }): RGBA;
