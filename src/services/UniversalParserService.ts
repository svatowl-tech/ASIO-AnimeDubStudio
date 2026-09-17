import { invoke, isTauri } from '@tauri-apps/api/core';
import { SubtitleLine } from '../types';

export interface ParsedScriptLine {
  index: number;
  character?: string;
  text: string;
  original_time_start_ms?: number;
  original_time_end_ms?: number;
  stage_directions?: string;
  is_foley_sfx: boolean;
}

export interface ParsedScriptResponse {
  file_name: string;
  total_lines: number;
  characters: string[];
  lines: ParsedScriptLine[];
}

export class UniversalParserService {
  /**
   * High-performance Native Script Parser (Tauri v2 + Rayon multi-threaded engine)
   * Handles DOCX, PDF, EPUB, ASS, SRT, VTT, FB2, CSV, TXT without client-side memory bloat.
   */
  static async parseScriptFile(filePath: string): Promise<ParsedScriptResponse> {
    if (isTauri()) {
      try {
        const res = await invoke<ParsedScriptResponse>('parse_script_file', { filePath });
        if (res && Array.isArray(res.lines)) {
          return res;
        }
      } catch (err) {
        console.warn('[UniversalParserService] Native parsing failed, falling back to local text parser:', err);
      }
    }

    // Fallback if not running in Tauri or file inaccessible
    return {
      file_name: filePath.split(/[/\\]/).pop() || 'script',
      total_lines: 0,
      characters: [],
      lines: [],
    };
  }

  /**
   * Primary unified parser interface returning SubtitleLine[] for timeline & editor.
   * If filePath is provided (or in Tauri), utilizes the multi-threaded Rust engine.
   */
  static async parse(
    content: string | ArrayBuffer,
    fileName: string,
    filePath?: string
  ): Promise<SubtitleLine[]> {
    // 1. If we have a file path in Tauri environment, use native Rust parsing engine
    if (filePath && isTauri()) {
      try {
        const response = await this.parseScriptFile(filePath);
        if (response.lines.length > 0) {
          return this.mapToSubtitleLines(response);
        }
      } catch (e) {
        console.warn('[UniversalParserService] Native parse failed, falling back to in-memory parser', e);
      }
    }

    // 2. High-speed lightweight in-memory parser (ASS, SRT, VTT, CSV, FB2, TXT)
    const extension = fileName.split('.').pop()?.toLowerCase() || 'txt';
    const isText = typeof content === 'string';
    const normalizedContent = isText ? (content as string).replace(/\r\n/g, '\n') : '';

    switch (extension) {
      case 'ass':
      case 'ssa':
        return this.parseASS(normalizedContent);
      case 'srt':
        return this.parseSRT(normalizedContent);
      case 'vtt':
        return this.parseVTT(normalizedContent);
      case 'csv':
        return this.parseCSV(normalizedContent);
      case 'fb2':
        return this.parseFB2(normalizedContent);
      case 'txt':
      default:
        return this.parseTXT(normalizedContent);
    }
  }

  /**
   * Maps native ParsedScriptResponse to standard SubtitleLine[]
   */
  static mapToSubtitleLines(response: ParsedScriptResponse): SubtitleLine[] {
    const timestamp = Date.now();
    return response.lines.map((line, idx) => {
      const startSec = line.original_time_start_ms !== undefined && line.original_time_start_ms !== null
        ? line.original_time_start_ms / 1000
        : 0;
      const endSec = line.original_time_end_ms !== undefined && line.original_time_end_ms !== null
        ? line.original_time_end_ms / 1000
        : 0;

      let displayText = line.text;
      if (line.stage_directions) {
        displayText = `(${line.stage_directions}) ${displayText}`.trim();
      }

      return {
        id: `sub-${idx}-${timestamp}`,
        start: startSec,
        end: endSec >= startSec ? endSec : startSec,
        text: displayText,
        role: line.character || (line.is_foley_sfx ? 'SFX' : 'Default'),
      };
    });
  }

  // =========================================================================
  // Lightweight In-Memory Parsers (Zero External Dependencies)
  // =========================================================================

  private static parseASS(content: string): SubtitleLine[] {
    const lines: SubtitleLine[] = [];
    const assLines = content.split('\n');
    let inEvents = false;
    let formatHeaders: string[] = [];

    const assTagRegex = /\{[^}]+\}/g;

    for (const line of assLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        inEvents = trimmed.toLowerCase() === '[events]';
        continue;
      }

      if (inEvents) {
        if (trimmed.startsWith('Format:')) {
          formatHeaders = trimmed.substring(7).split(',').map(h => h.trim().toLowerCase());
        } else if (trimmed.startsWith('Dialogue:')) {
          const maxFields = formatHeaders.length > 0 ? formatHeaders.length : 10;
          const commaSplit = this.splitN(trimmed.substring(9).trim(), ',', maxFields);
          
          let startIdx = 1;
          let endIdx = 2;
          let nameIdx = 4;
          let textIdx = commaSplit.length - 1;

          if (formatHeaders.length > 0) {
            formatHeaders.forEach((h, i) => {
              if (h === 'start') startIdx = i;
              if (h === 'end') endIdx = i;
              if (h === 'name' || h === 'actor') nameIdx = i;
              if (h === 'text') textIdx = i;
            });
          }

          const startStr = commaSplit[startIdx] || '0:00:00.00';
          const endStr = commaSplit[endIdx] || '0:00:00.00';
          const nameStr = commaSplit[nameIdx] || 'Default';
          const rawText = commaSplit[textIdx] || '';

          const cleanText = rawText
            .replace(assTagRegex, '')
            .replace(/\\N/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\h/g, ' ')
            .trim();

          if (cleanText.length > 0) {
            lines.push({
              id: `ass-${lines.length}-${Date.now()}`,
              start: this.assTimeToSeconds(startStr),
              end: this.assTimeToSeconds(endStr),
              text: cleanText,
              role: nameStr.trim() || 'Default',
            });
          }
        }
      }
    }

    return lines;
  }

  private static parseSRT(content: string): SubtitleLine[] {
    const lines: SubtitleLine[] = [];
    const srtRegex = /\d+\n(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})\n([\s\S]*?)(?=\n\n|\n$|$)/g;

    let match;
    while ((match = srtRegex.exec(content)) !== null) {
      const [, startStr, endStr, text] = match;
      const cleanText = text
        .replace(/<[^>]+>/g, '')
        .replace(/\{[^}]+\}/g, '')
        .trim()
        .replace(/\r?\n/g, ' ');

      const start = this.srtTimeToSeconds(startStr);
      let end = this.srtTimeToSeconds(endStr);
      if (end < start) end = start;

      const { role, text: dialogueText } = this.extractRoleAndText(cleanText);

      lines.push({
        id: `srt-${lines.length}-${Date.now()}`,
        start,
        end,
        text: dialogueText,
        role: role || 'Default',
      });
    }
    return lines;
  }

  private static parseVTT(content: string): SubtitleLine[] {
    const lines: SubtitleLine[] = [];
    const vttRegex = /(?:.+)?\n?(\d{2}:\d{2}(?::\d{2})?\.\d{3})\s*-->\s*(\d{2}:\d{2}(?::\d{2})?\.\d{3})(?:.*?)\n([\s\S]*?)(?=\n\n|\n$|$)/g;

    let match;
    while ((match = vttRegex.exec(content)) !== null) {
      const [, startStr, endStr, text] = match;
      if (text.trim().toLowerCase() === 'webvtt') continue;

      let role = 'Default';
      const voiceMatch = text.match(/<v\s+([^>]+)>/i);
      if (voiceMatch) {
        role = voiceMatch[1].trim();
      }

      const cleanText = text.replace(/<[^>]+>/g, '').trim().replace(/\r?\n/g, ' ');
      const start = this.vttTimeToSeconds(startStr);
      let end = this.vttTimeToSeconds(endStr);
      if (end < start) end = start;

      lines.push({
        id: `vtt-${lines.length}-${Date.now()}`,
        start,
        end,
        text: cleanText,
        role,
      });
    }
    return lines;
  }

  private static parseCSV(content: string): SubtitleLine[] {
    const lines: SubtitleLine[] = [];
    const rows = content.split('\n').filter(line => line.trim().length > 0);

    rows.forEach((row, index) => {
      const parts = row.includes(';') ? row.split(';') : row.split(',');
      let role = 'Default';
      let text = parts[0] || '';

      if (parts.length >= 2) {
        role = parts[0].trim().replace(/^["']|["']$/g, '');
        text = parts.slice(1).join(',').trim().replace(/^["']|["']$/g, '');
      }

      if (text.trim().length > 0) {
        lines.push({
          id: `csv-${index}-${Date.now()}`,
          start: 0,
          end: 0,
          text: text.trim(),
          role: role || 'Default',
        });
      }
    });

    return lines;
  }

  private static parseFB2(content: string): SubtitleLine[] {
    const lines: SubtitleLine[] = [];
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    let index = 0;

    while ((match = pRegex.exec(content)) !== null) {
      const text = match[1].replace(/<[^>]+>/g, '').trim();
      if (text.length > 0) {
        const { role, text: cleanText } = this.extractRoleAndText(text);
        lines.push({
          id: `fb2-${index++}-${Date.now()}`,
          start: 0,
          end: 0,
          text: cleanText,
          role: role || 'Default',
        });
      }
    }
    return lines;
  }

  private static parseTXT(content: string): SubtitleLine[] {
    return content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map((line, index) => {
        const { role, text } = this.extractRoleAndText(line);
        return {
          id: `txt-${index}-${Date.now()}`,
          start: 0,
          end: 0,
          text,
          role: role || 'Default',
        };
      });
  }

  // =========================================================================
  // Heuristic Utilities
  // =========================================================================

  private static extractRoleAndText(line: string): { role?: string; text: string } {
    const colonMatch = line.match(/^([А-ЯЁA-Z0-9_\s\-\.]{2,30})\s*(?:\([^)]+\))?\s*[:—–\-]\s*(.+)$/i);
    if (colonMatch) {
      const role = colonMatch[1].trim();
      const text = colonMatch[2].trim();
      if (text.length > 0) {
        return { role, text };
      }
    }
    return { text: line };
  }

  private static assTimeToSeconds(time: string): number {
    const parts = time.split(':');
    if (parts.length !== 3) return 0;
    const h = Number(parts[0]) || 0;
    const m = Number(parts[1]) || 0;
    const [s, cs] = parts[2].split('.');
    const seconds = Number(s) || 0;
    const centiseconds = Number(cs) || 0;
    return h * 3600 + m * 60 + seconds + centiseconds / 100;
  }

  private static srtTimeToSeconds(time: string): number {
    const splitChar = time.includes(',') ? ',' : '.';
    const [hms, ms] = time.split(splitChar);
    if (!hms) return 0;
    const [h, m, s] = hms.split(':').map(Number);
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0) + (Number(ms) || 0) / 1000;
  }

  private static vttTimeToSeconds(time: string): number {
    const parts = time.split('.');
    const hms = parts[0];
    const ms = parts[1] ? Number(parts[1]) / 1000 : 0;
    const timeParts = hms.split(':').map(Number);

    if (timeParts.length === 3) {
      return (timeParts[0] || 0) * 3600 + (timeParts[1] || 0) * 60 + (timeParts[2] || 0) + ms;
    } else if (timeParts.length === 2) {
      return (timeParts[0] || 0) * 60 + (timeParts[1] || 0) + ms;
    }
    return 0;
  }

  private static splitN(str: string, delimiter: string, n: number): string[] {
    const parts: string[] = [];
    let current = str;
    for (let i = 0; i < n - 1; i++) {
      const idx = current.indexOf(delimiter);
      if (idx === -1) break;
      parts.push(current.substring(0, idx));
      current = current.substring(idx + delimiter.length);
    }
    parts.push(current);
    return parts;
  }
}
