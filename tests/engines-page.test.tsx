import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// W1-02-r1: the Engines/proof/scenario composition. Facts come from the real
// registry; packages and presentations come from the real wire parser and the
// real present() — no hand-cast fixtures anywhere in this file.
import { EnginesPage, ScenarioPage, ProofBlock } from '../src/routes/engines';
import { renderRoute } from '../src/app/render';
import {
  parseDemoPackage,
  parseScenarioRegistry,
  present,
  type DemoPackage,
  type DemoPresentation,
  type ScenarioRegistryRow,
} from '../src/clients/demo';
import {
  engineScenarios,
  engines,
  enginesById,
  enginesDestination,
} from '../src/data/engines';
import enginesSource from '../src/routes/engines.tsx?raw';

// Fixed clock and contract-complete fixture fields, in the style of
// tests/demo-schema.test.ts: immutable revision-anchored HTTPS URLs, complete
// evidence/approval/hash, one board scenario id. Overrides replace one field
// at a time; when the package revision changes, the URLs follow it so the
// immutability gate is real rather than bypassed.
const FETCHED_AT = Date.parse('2026-10-29T09:00:00Z');
const SOURCE_REVISION = 'a'.repeat(40);
const PACKAGE_REVISION = 'rev-2026-10-25-1';
const SCENARIO_ID = 'teams-01';
const CONTENT_HASH = 'd'.repeat(64);
const APPROVED_AT = '2026-10-25T12:00:00Z';

function wellFormed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const revision =
    typeof overrides.packageRevision === 'string' ? overrides.packageRevision : PACKAGE_REVISION;
  const base = `https://media.example.com/demos/${SCENARIO_ID}/${revision}`;
  return {
    schema: 'rhobear.demo-package.v1',
    engineOrProduct: 'teams',
    scenarioId: SCENARIO_ID,
    packageRevision: revision,
    publicationState: 'approved',
    sourceApp: 'capturd',
    sourceRevision: SOURCE_REVISION,
    renditions: [
      {
        url: `${base}/clip-720.mp4`,
        mime: 'video/mp4',
        width: 1280,
        height: 720,
        durationSeconds: 42,
        chapters: [{ label: 'Intro', startSeconds: 0 }],
      },
    ],
    posterUrl: `${base}/poster.png`,
    captionsUrl: `${base}/captions.vtt`,
    transcriptUrl: `${base}/transcript.html`,
    evidence: { runIds: ['run-1'], logs: [], artifactHashes: ['c'.repeat(64)] },
    approval: { approvedBy: 'Owner', approvedAt: APPROVED_AT, watchedComplete: true },
    contentHash: CONTENT_HASH,
    immutableUrls: true,
    ...overrides,
  };
}

const posterUrl = `https://media.example.com/demos/${SCENARIO_ID}/${PACKAGE_REVISION}/poster.png`;
const renditionUrl = `https://media.example.com/demos/${SCENARIO_ID}/${PACKAGE_REVISION}/clip-720.mp4`;
const captionsUrl = `https://media.example.com/demos/${SCENARIO_ID}/${PACKAGE_REVISION}/captions.vtt`;
const transcriptUrl = `https://media.example.com/demos/${SCENARIO_ID}/${PACKAGE_REVISION}/transcript.html`;

/** A real package through the real parser; overrides replace one field. */
function demoPackage(overrides: Record<string, unknown> = {}): DemoPackage {
  const parsed = parseDemoPackage(wellFormed(overrides));
  if (!('package' in parsed)) {
    throw new Error(`fixture refused by parseDemoPackage: ${parsed.problem}`);
  }
  return parsed.package;
}

/** A real presentation through the real present() — never a hand-built union. */
function demoPresentation(overrides: Record<string, unknown> = {}): DemoPresentation {
  return present(demoPackage(overrides), 'network', FETCHED_AT);
}

function playablePresentation(): Extract<DemoPresentation, { state: 'playable' }> {
  const presentation = demoPresentation();
  if (presentation.state !== 'playable') {
    throw new Error(`fixture did not present as playable: ${presentation.state}`);
  }
  return presentation;
}

/** A real registry row through parseScenarioRegistry — the test row shape. */
function registryRow(scenarioId: string = SCENARIO_ID): ScenarioRegistryRow {
  const parsed = parseScenarioRegistry([
    {
      scenarioId,
      engine: 'teams',
      title: 'Teams at work',
      oneLiner: 'One honest line.',
      posterAlt: 'Poster alt text',
      order: 1,
    },
  ]);
  if (!('rows' in parsed)) {
    throw new Error(`registry fixture refused: ${parsed.problem}`);
  }
  return parsed.rows[0];
}

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

/** The entity spellings renderToStaticMarkup emits, decoded back to text. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** The visible text runs of a markup fragment, each one normalised. */
function visibleRuns(fragment: string): string[] {
  return [...fragment.matchAll(/>([^<>]+)</g)]
    .map((match) => decodeEntities(match[1]).trim().replace(/^·\s*/, ''))
    .filter((text) => text !== '');
}

describe('W1-02-r1 engines and proof states', () => {
  it('engines index renders exactly seven engines in registry order', () => {
    const html = renderToStaticMarkup(createElement(EnginesPage));
    const decoded = decodeEntities(html);
    expect(engines.length).toBe(7);
    // Names and MCP handles in `engines` array order: each first occurrence
    // sits after the previous one, so a reordered or invented entry fails.
    let cursor = -1;
    for (const engine of engines) {
      const nameAt = decoded.indexOf(engine.publicName);
      expect(nameAt, engine.publicName).toBeGreaterThan(cursor);
      cursor = nameAt;
      const handleAt = decoded.indexOf(engine.mcpHandle);
      expect(handleAt, engine.mcpHandle).toBeGreaterThan(cursor);
      cursor = handleAt;
    }
    // One proof block (one pending state) and one proof-shell link per engine.
    expect(occurrences(html, 'Recording in review')).toBe(7);
    expect(occurrences(html, 'Open proof shell')).toBe(7);
    // No Imagine, no eighth entry: the headings are exactly the registry
    // names in order, then the pinned Live samples section.
    expect(html).not.toMatch(/Imagine/i);
    const headings = [...decoded.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1]);
    expect(headings).toEqual([...engines.map((engine) => engine.publicName), 'Live samples']);
    // No invented description: every visible run is an approved data string
    // or one of the labels/sentences the brief pins.
    const pinned = [
      'Builds mini app',
      '@ MCP',
      'Recording in review',
      'The real recording, captions and transcript appear after approval. No mock or stock clip is shown.',
      'Open proof shell',
      'Live samples',
      'Try a sample',
      'Samples open when the engine service and quota are live.',
    ];
    const approved = [
      enginesDestination.whatItIs,
      ...engines.flatMap((engine) => [engine.publicName, engine.mcpHandle]),
      ...pinned,
    ];
    for (const run of visibleRuns(html)) {
      const hit = approved.some((approvedText) =>
        approvedText.toLowerCase().includes(run.toLowerCase()),
      );
      expect(hit, `unapproved text node "${run}"`).toBe(true);
    }
  });

  it('footage-pending has no media or play control', () => {
    const html = renderToStaticMarkup(
      createElement(ProofBlock, {
        presentation: { state: 'footage-pending', reason: 'footage-pending' },
      }),
    );
    // Exact review label and exact copy, and nothing else.
    expect(visibleRuns(html)).toEqual([
      'Recording in review',
      'The real recording, captions and transcript appear after approval. No mock or stock clip is shown.',
    ]);
    expect(html).not.toMatch(/<img|<video|<iframe|<audio|<source/i);
    expect(html).not.toMatch(/<button|<input/i);
  });

  it('approved proof is poster-only with real accessibility and revision metadata', () => {
    const presentation = playablePresentation();
    const scenario = registryRow();
    const pkg = demoPackage();
    const html = renderToStaticMarkup(
      createElement(ProofBlock, { presentation, scenario, package: pkg }),
    );
    // Exactly one image, the real poster URL and the registry alt text.
    const images = [...html.matchAll(/<img [^>]*>/g)].map((match) => match[0]);
    expect(images.length).toBe(1);
    expect(images[0]).toContain(`src="${posterUrl}"`);
    expect(images[0]).toContain('alt="Poster alt text"');
    // A picture is not a player.
    expect(html).not.toMatch(/<video|<iframe|<audio|<source/i);
    expect(html).not.toMatch(/<button/i);
    // The rendition's actual duration, in the mandated form.
    expect(html).toContain('42 seconds');
    // The real captions and transcript URLs, labelled.
    expect(html).toContain('Captions');
    expect(html).toContain(`href="${captionsUrl}"`);
    expect(html).toContain('Transcript');
    expect(html).toContain(`href="${transcriptUrl}"`);
    // The actual revision/source/hash/source/fetchedAt from the presentation.
    expect(html).toContain(PACKAGE_REVISION);
    expect(html).toContain(SOURCE_REVISION);
    expect(html).toContain(CONTENT_HASH);
    expect(html).toContain('network');
    expect(html).toContain(String(FETCHED_AT));
    // The matching package's real sourceApp, approver and approval date.
    expect(html).toContain('capturd');
    expect(html).toContain('Owner');
    expect(html).toContain(APPROVED_AT);
    // Without a matching registry row the image is omitted — alt text is
    // never invented and the proof never becomes a video.
    const withoutRow = renderToStaticMarkup(createElement(ProofBlock, { presentation, package: pkg }));
    expect(withoutRow).not.toContain('<img');
    expect(withoutRow).not.toMatch(/alt=/);
    expect(withoutRow).not.toMatch(/<video|<iframe|<audio|<source/i);
    const wrongRow = renderToStaticMarkup(
      createElement(ProofBlock, {
        presentation,
        scenario: registryRow('designs-01'),
        package: pkg,
      }),
    );
    expect(wrongRow).not.toContain('<img');
    expect(wrongRow).not.toMatch(/<video|<iframe|<audio|<source/i);
  });

  it('mismatched package metadata is omitted', () => {
    const presentation = playablePresentation();
    const scenario = registryRow();
    // One identity field changed at a time; sourceApp/approval stay the ones
    // that must never leak when any identity field mismatches.
    const variants: readonly (readonly [string, Record<string, unknown>])[] = [
      ['scenarioId', { scenarioId: 'designs-01' }],
      ['packageRevision', { packageRevision: 'rev-2026-10-25-2' }],
      ['sourceRevision', { sourceRevision: 'b'.repeat(40) }],
      ['contentHash', { contentHash: 'e'.repeat(64) }],
    ];
    for (const [field, overrides] of variants) {
      const html = renderToStaticMarkup(
        createElement(ProofBlock, {
          presentation,
          scenario,
          package: demoPackage(overrides),
        }),
      );
      expect(html, field).not.toContain('capturd');
      expect(html, field).not.toContain('Owner');
      expect(html, field).not.toContain(APPROVED_AT);
      expect(html, field).not.toMatch(/verified/i);
    }
  });

  it('revoked proof keeps only its transcript', () => {
    const presentation = demoPresentation({ publicationState: 'revoked' });
    expect(presentation.state).toBe('revoked');
    const html = renderToStaticMarkup(
      createElement(ProofBlock, {
        presentation,
        scenario: registryRow(),
        package: demoPackage({ publicationState: 'revoked' }),
      }),
    );
    expect(html).toContain('Recording revoked');
    expect(html).toContain('This proof has been revoked.');
    // The real transcript link, and nothing else from the package.
    expect(html).toContain('Transcript');
    expect(html).toContain(`href="${transcriptUrl}"`);
    expect(html).not.toContain('capturd');
    expect(html).not.toContain('Owner');
    expect(html).not.toMatch(/<img|<video|<iframe|<audio|<source/i);
    expect(html).not.toMatch(/<button/i);
    // A revoked proof with no transcript shows no empty link at all.
    const none = renderToStaticMarkup(
      createElement(ProofBlock, {
        presentation: demoPresentation({
          publicationState: 'revoked',
          transcriptUrl: null,
        }),
      }),
    );
    expect(none).toContain('Recording revoked');
    expect(none).not.toContain('Transcript');
    expect(none).not.toContain('<a ');
  });

  it('superseded and invalid proof fail closed', () => {
    // Superseded: named state and copy, no media and no old URLs.
    const supersededHtml = renderToStaticMarkup(
      createElement(ProofBlock, {
        presentation: demoPresentation({ publicationState: 'superseded' }),
        package: demoPackage({ publicationState: 'superseded' }),
      }),
    );
    expect(supersededHtml).toContain('Recording superseded');
    expect(supersededHtml).toContain('This proof is historical and is not current proof.');
    expect(supersededHtml).not.toMatch(/<img|<video|<iframe|<audio|<source|<button/i);
    expect(supersededHtml).not.toContain(posterUrl);
    expect(supersededHtml).not.toContain(renditionUrl);
    // Invalid: each real named reason from present(), safe copy and support.
    const invalids: readonly (readonly [Record<string, unknown>, string])[] = [
      [{ captionsUrl: null }, 'captions-required'],
      [
        { approval: { approvedBy: '', approvedAt: '', watchedComplete: false } },
        'approval-incomplete',
      ],
    ];
    for (const [overrides, reason] of invalids) {
      const presentation = demoPresentation(overrides);
      expect(presentation, reason).toEqual({ state: 'invalid', reason });
      const html = renderToStaticMarkup(
        createElement(ProofBlock, { presentation, package: demoPackage(overrides) }),
      );
      expect(html, reason).toContain('Proof unavailable');
      expect(html, reason).toContain(reason);
      expect(html, reason).toContain('Support');
      expect(html, reason).toContain('href="/support"');
      expect(html, reason).not.toMatch(/<img|<video|<iframe|<audio|<source|<button/i);
      expect(html, reason).not.toContain(posterUrl);
      expect(html, reason).not.toContain(renditionUrl);
    }
  });

  it('known scenario shells are pending and unknown scenarios stay 404', () => {
    expect(engineScenarios.length).toBe(7);
    for (const row of engineScenarios) {
      const engine = enginesById[row.engineId];
      const html = renderToStaticMarkup(createElement(ScenarioPage, { scenarioId: row.scenarioId }));
      // Its own engine, its own MCP handle, the pending proof state.
      expect(html, row.scenarioId).toContain(engine.publicName);
      expect(html, row.scenarioId).toContain(engine.mcpHandle);
      expect(html, row.scenarioId).toContain('Recording in review');
      expect(html, row.scenarioId).toContain(
        'The real recording, captions and transcript appear after approval. No mock or stock clip is shown.',
      );
      expect(html, row.scenarioId).toContain('Back to Engines');
      expect(html, row.scenarioId).toContain('href="/engines"');
      for (const other of engines) {
        if (other.id !== engine.id) {
          expect(html, `${row.scenarioId} not ${other.id}`).not.toContain(other.mcpHandle);
        }
      }
    }
    // A direct call with an unknown id fails closed and invents no page.
    const unknown = renderToStaticMarkup(
      createElement(ScenarioPage, { scenarioId: 'invented-99' }),
    );
    expect(unknown).toContain('Proof unavailable');
    expect(unknown).toContain('Support');
    expect(unknown).toContain('href="/support"');
    expect(unknown).not.toMatch(/<img|<video|<iframe|<audio|<source/i);
    // Normal routing still sends unknown paths to the 404 page.
    const notFound = renderRoute('/engines/invented-99');
    expect(notFound).toContain('Page not found');
    expect(notFound).not.toContain('Recording in review');
    expect(notFound).not.toContain('Open proof shell');
    expect(notFound).not.toContain('invented-99');
  });

  it('live samples are present but disabled and no price or quota is invented', () => {
    const html = renderToStaticMarkup(createElement(EnginesPage));
    // The one sample control is a real, disabled button with the exact label.
    const sampleButtons = [...html.matchAll(/<button[^>]*>Try a sample<\/button>/g)].map(
      (match) => match[0],
    );
    expect(sampleButtons.length).toBe(1);
    expect(sampleButtons[0]).toContain('disabled');
    expect(html).toContain('Samples open when the engine service and quota are live.');
    // No price, no numeric quota, no reservation or availability claim.
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toMatch(/\b\d[\d,]*\s*(quota|credits|samples|seats|invites)\b/i);
    expect(html).not.toMatch(/reserved|available now|guaranteed/i);
    // No enabled sample form anywhere.
    expect(html).not.toMatch(/<form|<input/);
    // The permitted Plans link exists and still carries no money field.
    expect(html).toContain('Plans');
    expect(html).toContain('href="/plans"');
  });

  it('current engines and scenario pages contain no media or scripts', () => {
    const paths = ['/engines', ...engineScenarios.map((s) => `/engines/${s.scenarioId}`)];
    for (const path of paths) {
      const html = renderRoute(path);
      expect((html.match(/<h1[\s>]/g) ?? []).length, `${path}: one h1`).toBe(1);
      expect(html, path).not.toMatch(/<img|<video|<iframe|<audio|<source/i);
      expect(html, `${path}: no script`).not.toContain('<script');
      expect(html, `${path}: no undefined`).not.toContain('undefined');
      expect(html, `${path}: no NaN`).not.toContain('NaN');
      expect(html, `${path}: pending proof`).toContain('Recording in review');
    }
  });

  it('proof layout is static and reduced-motion safe', () => {
    // No animation/transition, no fixed-width container, no raw design token.
    expect(enginesSource).not.toMatch(/animation|transition/i);
    expect(enginesSource).not.toMatch(
      /#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|\bcolor\s*:|font-family|font-size/i,
    );
    expect(enginesSource).not.toMatch(/(?:^|[^A-Za-z])width\s*[:=]/i);
    for (const match of enginesSource.matchAll(/maxWidth\s*:\s*([^,}]+)/g)) {
      expect(match[1].trim(), 'maxWidth is only the 100% wrap').toBe("'100%'");
    }
    // Every action keeps the 44 px minimum dimensions through the kit.
    const screens = [
      renderToStaticMarkup(createElement(EnginesPage)),
      renderToStaticMarkup(createElement(ScenarioPage, { scenarioId: SCENARIO_ID })),
      renderToStaticMarkup(createElement(ScenarioPage, { scenarioId: 'invented-99' })),
      renderToStaticMarkup(
        createElement(ProofBlock, {
          presentation: playablePresentation(),
          scenario: registryRow(),
          package: demoPackage(),
        }),
      ),
    ];
    for (const html of screens) {
      const actions = [...html.matchAll(/<(?:a|button) [^>]*style="([^"]*)"/g)].map(
        (match) => match[1],
      );
      expect(actions.length).toBeGreaterThan(0);
      for (const style of actions) {
        expect(style, style).toContain('min-height:44px');
        expect(style, style).toContain('min-width:44px');
      }
    }
  });
});
