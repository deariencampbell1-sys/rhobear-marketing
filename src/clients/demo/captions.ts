// W0-05b: WebVTT presence and parse rules for demo captions (behaviour 20).
// A WebVTT file is required for a playable package — W0-05a's resolver
// refuses one without it (`captions-required`), and `isWebVttUrl` states the
// same rule at the URL level. What this module owns is the defensive parse:
// a malformed cue is skipped with a named reason, nothing is ever thrown into
// the UI, and the transcript stays available when captions fail.
//
// House style: hand-written parsing, named refusal codes, no schema library,
// no dependency, no coercion, no logging. The parse is total — every input,
// hostile or empty, returns a verdict.
//
// The parse rules, defensively:
//   - The body must begin with the `WEBVTT` signature — the word followed by
//     whitespace or the end of the line (`WEBVTT - some note` is the spec's
//     noted form; `WEBVTTX` is not a signature) — with a leading BOM
//     tolerated; anything else is `not-webvtt`.
//   - Cues are blocks separated by blank lines. A block may carry a cue
//     identifier line before its timing line; the timing line is
//     `start --> end` with optional settings after the end timestamp, and
//     timestamps are `HH:MM:SS.mmm` or `MM:SS.mmm` with spec-shaped fields.
//     The timing line is the first line matching that grammar (F7: a cue
//     identifier may itself contain `-->`, so a mere arrow is not enough);
//     a block with no grammar-matching line falls back to the first line
//     carrying `-->`, so a genuinely bad timing line is still named.
//   - A NOTE, STYLE or REGION block is not a cue — per the WebVTT grammar it
//     is a comment or metadata (F8) — so it is ignored entirely: it appears
//     neither in `cues` nor in `skipped`, and it consumes no cue index. The
//     keyword boundary is the grammar's: `NOTE`, `STYLE` or `REGION` followed
//     by whitespace or the end of the line starts the block — `NOTEPAD` is
//     merely a cue identifier and is judged by its own shape.
//   - A block whose timing line is missing or unparseable is skipped as
//     `bad-timing`; a cue that ends before it starts is skipped as
//     `end-before-start`; a cue with no text is skipped as `empty-text`.
//     Every skip names the cue's index among the file's cue blocks.
//   - Cues that survive keep their wire order and their exact text lines.
//   - If no cue survives, the verdict is `captions-failed` with reason
//     `no-cues` (`not-webvtt` when the signature is missing) — and the
//     transcript URL passed in is reported as still available, because a
//     captions failure never takes the transcript down with it.

/**
 * One cue. `text` is display text: a screen must render it **as text**, never
 * as HTML — markup-like content in a cue payload is characters, not markup
 * (F10: the cue-text contract, stated where the type is).
 */
export type WebVttCue = { startSeconds: number; endSeconds: number; text: string };

export type CaptionCueProblem = 'bad-timing' | 'end-before-start' | 'empty-text';

/**
 * A skipped cue, named by its index among the file's cue blocks (F8:
 * NOTE/STYLE/REGION blocks are not cue blocks and consume no index).
 */
export type SkippedCaptionCue = { cueIndex: number; reason: CaptionCueProblem };

export type CaptionsFailureReason = 'not-webvtt' | 'no-cues' | 'unreadable';

export type ParsedCaptions =
  | {
      state: 'captions';
      cues: readonly WebVttCue[];
      skipped: readonly SkippedCaptionCue[];
      transcriptAvailable: boolean;
    }
  | {
      state: 'captions-failed';
      reason: CaptionsFailureReason;
      cues: readonly WebVttCue[];
      skipped: readonly SkippedCaptionCue[];
      transcriptAvailable: boolean;
    };

/**
 * Presence at the URL level: a captions URL must name a WebVTT file, wherever
 * it points. The resolver already refuses a package without one; this states
 * the same rule for a URL a screen is about to read — http(s) or relative
 * (F9: the scheme is part of the rule — a `javascript:` or `data:` URL is
 * never captions, whatever its path ends in. r6 F6: a leading `//` is a
 * scheme-relative absolute reference — the scheme rule applies to it, so a
 * protocol-relative URL is never one of the front door's own captions).
 */
export function isWebVttUrl(value: string | null): boolean {
  if (typeof value !== 'string') return false;
  // r6 F6: `//host/x.vtt` is neither http(s) nor a relative path — it names
  // another host and is refused before any parsing can wave it through.
  if (value.startsWith('//')) return false;
  // The extension is a rule about the path, not about absolute URLs: an
  // absolute URL is parsed so a query or fragment can never forge the
  // suffix; a relative one — the front door's own captions — is cut at `?`
  // or `#` by hand, and only then checked.
  let path = value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    path = url.pathname;
  } catch {
    const cut = path.search(/[?#]/);
    if (cut !== -1) path = path.slice(0, cut);
  }
  return path.toLowerCase().endsWith('.vtt');
}

const TIMESTAMP_HMS = /^(\d{2,}):([0-5]\d):([0-5]\d)\.(\d{3})$/;
const TIMESTAMP_MS = /^(\d{1,2}):([0-5]\d)\.(\d{3})$/;

// F8: per the WebVTT grammar these keyword blocks are a comment (NOTE) or
// metadata (STYLE, REGION) — never cues. The keyword must be followed by
// whitespace or the end of the line: `NOTEPAD` is not `NOTE`.
const NON_CUE_BLOCK = /^(NOTE|STYLE|REGION)(\s|$)/;

function parseTimestamp(raw: string): number | null {
  const hms = TIMESTAMP_HMS.exec(raw);
  if (hms !== null) {
    return (
      Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]) + Number(hms[4]) / 1000
    );
  }
  const ms = TIMESTAMP_MS.exec(raw);
  if (ms !== null) return Number(ms[1]) * 60 + Number(ms[2]) + Number(ms[3]) / 1000;
  return null;
}

/**
 * Does this line carry the block's timing — `start --> end` with optional
 * settings after the end timestamp, timestamps parseable by the grammar?
 * F7: a cue identifier may itself contain `-->`, so an arrow alone is not
 * the timing line.
 */
function isTimingLine(line: string): boolean {
  const arrow = line.indexOf('-->');
  if (arrow === -1) return false;
  const startSeconds = parseTimestamp(line.slice(0, arrow).trim());
  // Settings after the end timestamp (`align:start` and friends) are not
  // part of the timestamp.
  const endField = line.slice(arrow + 3).trim().split(/\s+/)[0] ?? '';
  return startSeconds !== null && parseTimestamp(endField) !== null;
}

/**
 * Parse one cue block's lines. The timing line is the first line matching the
 * timestamp grammar (F7); a block with no such line falls back to the first
 * line carrying `-->`, so a genuinely unparseable timing line is still named
 * `bad-timing`. Anything before the timing line is the cue identifier; the
 * rest is the cue text.
 */
function parseCueBlock(
  lines: readonly string[],
): { cue: WebVttCue } | { problem: CaptionCueProblem } {
  const grammarIndex = lines.findIndex(isTimingLine);
  const timingIndex =
    grammarIndex !== -1 ? grammarIndex : lines.findIndex((line) => line.includes('-->'));
  if (timingIndex === -1) return { problem: 'bad-timing' };
  const timing = lines[timingIndex];
  const arrow = timing.indexOf('-->');
  const startSeconds = parseTimestamp(timing.slice(0, arrow).trim());
  // Settings after the end timestamp (`align:start` and friends) are not
  // part of the timestamp.
  const endField = timing.slice(arrow + 3).trim().split(/\s+/)[0] ?? '';
  const endSeconds = parseTimestamp(endField);
  if (startSeconds === null || endSeconds === null) return { problem: 'bad-timing' };
  if (endSeconds < startSeconds) return { problem: 'end-before-start' };
  const text = lines
    .slice(timingIndex + 1)
    .join('\n')
    .trim();
  if (text === '') return { problem: 'empty-text' };
  return { cue: { startSeconds, endSeconds, text } };
}

export function parseWebVTT(raw: string, transcriptUrl: string | null): ParsedCaptions {
  const transcriptAvailable = typeof transcriptUrl === 'string' && transcriptUrl.trim() !== '';
  try {
    // One canonical line ending, and a tolerated BOM: hostile whitespace
    // never changes a verdict.
    const body = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const lines = body.split('\n');
    const first = lines.find((line) => line.trim() !== '') ?? '';
    // The signature is the word WEBVTT and nothing longer: a line that merely
    // starts with those letters (`WEBVTTX`) is not a WebVTT header.
    if (!/^WEBVTT(\s|$)/.test(first)) {
      return {
        state: 'captions-failed',
        reason: 'not-webvtt',
        cues: [],
        skipped: [],
        transcriptAvailable,
      };
    }
    // The header runs to the first blank line; everything after is cues.
    let index = lines.indexOf(first) + 1;
    while (index < lines.length && lines[index].trim() !== '') index += 1;
    const blocks: string[][] = [];
    let block: string[] = [];
    for (; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() === '') {
        if (block.length > 0) blocks.push(block);
        block = [];
      } else {
        block.push(line);
      }
    }
    if (block.length > 0) blocks.push(block);

    // F8: NOTE, STYLE and REGION blocks are not cues — they appear neither
    // in `cues` nor in `skipped`, and the skip indices below number the
    // file's cue blocks only.
    const cueBlocks = blocks.filter((block) => !NON_CUE_BLOCK.test(block[0] ?? ''));

    const cues: WebVttCue[] = [];
    const skipped: SkippedCaptionCue[] = [];
    for (let cueIndex = 0; cueIndex < cueBlocks.length; cueIndex += 1) {
      const parsed = parseCueBlock(cueBlocks[cueIndex]);
      if ('cue' in parsed) cues.push(parsed.cue);
      else skipped.push({ cueIndex, reason: parsed.problem });
    }
    if (cues.length === 0) {
      return { state: 'captions-failed', reason: 'no-cues', cues, skipped, transcriptAvailable };
    }
    return { state: 'captions', cues, skipped, transcriptAvailable };
  } catch {
    // Nothing is ever thrown into the UI: an unreadable body is a named
    // verdict, and the transcript is still there.
    return {
      state: 'captions-failed',
      reason: 'unreadable',
      cues: [],
      skipped: [],
      transcriptAvailable,
    };
  }
}
