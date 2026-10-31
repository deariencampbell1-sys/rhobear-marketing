// W1-02-r1: the Engines destination (U06/U07), the proof block over the real
// DemoPresentation union, and the registry-driven scenario shells. Facts come
// straight from src/data/engines — the data composition entry point is
// deliberately not used here — and nothing on these screens resolves,
// fetches or plays a demo package: W3 owns real resolution and playback.
//
// Structural-only styling, as W1-01: 16 px phone gutters, 24 px block
// spacing, wrapping rows, the 100% media wrap, kit actions at 44 px minima
// with the visible kit focus. No visual system is added here — no fixed
// container, no colour, font or motion values, and no motion of any kind.
// Everything is server-rendered and readable with JavaScript disabled.
import type { CSSProperties, ReactNode } from 'react';
import type { DemoPackage, DemoPresentation, ScenarioRegistryRow } from '../clients/demo';
import {
  engineLabels,
  engineScenarios,
  engines,
  enginesById,
  enginesDestination,
  pendingProofPresentation,
  runLabels,
  scenarioPresentation,
  unknownScenarioPresentation,
} from '../data/engines';
import { Button, InfoList, InfoRow } from '../kit';

// Structural layout only: wrapping flex for action rows, page padding and the
// media wrap. No visual values beyond these.
const pagePadding: CSSProperties = { paddingInline: '16px', paddingBlock: '24px' };
const actionRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px' };
const responsiveMedia: CSSProperties = { maxWidth: '100%' };

/**
 * The page's main action container. `data-primary="true"` marks it for the
 * acceptance check; the kit Button guarantees the 44 px minimum dimensions
 * and the visible kit focus on every action inside it.
 */
function MainActions({ children }: { children: ReactNode }) {
  return (
    <div data-primary="true" style={actionRow}>
      {children}
    </div>
  );
}

/**
 * The proof block: the exhaustive rendering of the real DemoPresentation
 * union, in the fail-closed precedence the contract pins. Only `playable`
 * carries media, and then only as a poster plus real captions, transcript and
 * revision metadata — a picture is not a player, and no state is ever
 * relabelled as playable. Optional package metadata (sourceApp, approver,
 * approval date) appears only for an approved package whose identity fields
 * exactly match the playable presentation; otherwise it is omitted in full.
 */
export function ProofBlock(props: {
  presentation: DemoPresentation;
  scenario?: ScenarioRegistryRow;
  package?: DemoPackage;
}): JSX.Element {
  const presentation = props.presentation;
  const scenario = props.scenario;
  const pkg = props.package;

  switch (presentation.state) {
    case 'footage-pending':
      return (
        <div style={pagePadding}>
          <p>{engineLabels.pendingTitle}</p>
          <p>{engineLabels.pendingBody}</p>
        </div>
      );
    case 'playable': {
      // The metadata gate: package defined, approved, and every identity
      // field identical to the playable presentation. One mismatch omits all
      // three fields; nothing is labelled verified merely for existing.
      const showPackageMetadata =
        pkg !== undefined &&
        pkg.publicationState === 'approved' &&
        pkg.scenarioId === presentation.scenarioId &&
        pkg.packageRevision === presentation.packageRevision &&
        pkg.sourceRevision === presentation.sourceRevision &&
        pkg.contentHash === presentation.contentHash;
      return (
        <div style={pagePadding}>
          {scenario !== undefined && scenario.scenarioId === presentation.scenarioId ? (
            <img
              src={presentation.media.posterUrl}
              alt={scenario.posterAlt}
              style={responsiveMedia}
            />
          ) : null}
          <InfoList>
            {presentation.media.renditions.map((rendition) => (
              <InfoRow
                key={rendition.url}
                label="durationSeconds"
                value={`${rendition.durationSeconds} seconds`}
              />
            ))}
            <InfoRow label="packageRevision" value={presentation.packageRevision} />
            <InfoRow label="sourceRevision" value={presentation.sourceRevision} />
            <InfoRow label="contentHash" value={presentation.contentHash} />
            <InfoRow label="source" value={presentation.source} />
            <InfoRow label="fetchedAt" value={String(presentation.fetchedAt)} />
          </InfoList>
          <p>
            <Button as="a" href={presentation.captionsUrl} variant="secondary">
              {engineLabels.captions}
            </Button>{' '}
            <Button as="a" href={presentation.transcriptUrl} variant="secondary">
              {engineLabels.transcript}
            </Button>
          </p>
          {showPackageMetadata && pkg !== undefined ? (
            <InfoList>
              <InfoRow label="sourceApp" value={pkg.sourceApp} />
              <InfoRow label="approvedBy" value={pkg.approval.approvedBy} />
              <InfoRow label="approvedAt" value={pkg.approval.approvedAt} />
            </InfoList>
          ) : null}
        </div>
      );
    }
    case 'revoked':
      return (
        <div style={pagePadding}>
          <p>{engineLabels.revokedTitle}</p>
          <p>{engineLabels.revokedBody}</p>
          {presentation.transcriptUrl !== null ? (
            <p>
              <Button as="a" href={presentation.transcriptUrl} variant="secondary">
                {engineLabels.transcript}
              </Button>
            </p>
          ) : null}
        </div>
      );
    case 'superseded':
      return (
        <div style={pagePadding}>
          <p>{engineLabels.supersededTitle}</p>
          <p>{engineLabels.supersededBody}</p>
        </div>
      );
    case 'invalid':
      return (
        <div style={pagePadding}>
          <p>{engineLabels.invalidTitle}</p>
          <p>{presentation.reason}</p>
          <p>
            <Button as="a" href="/support" variant="secondary">
              {engineLabels.support}
            </Button>
          </p>
        </div>
      );
  }
}

/**
 * U06/U07: the Engines index. The approved what-it-is body, then the seven
 * registry engines in order — name, MCP handle, run-location labels and one
 * footage-pending proof block each — linked to their registry scenarios.
 * Each entry is a section of sibling 24 px blocks (W1-01's block pattern);
 * the first engine's action container is the page's data-primary container.
 * Then the Live samples section: one disabled sample action and the pinned
 * dependency sentence. No per-engine description exists, so none is written;
 * the permitted Plans link carries no price or money field.
 */
export function EnginesPage(): JSX.Element {
  return (
    <>
      <div style={pagePadding}>
        <p>{enginesDestination.whatItIs}</p>
      </div>
      {engines.map((engine, index) => {
        const actions = (
          <>
            {engine.scenarioIds.map((scenarioId) => (
              <Button key={scenarioId} as="a" href={`/engines/${scenarioId}`}>
                {engineLabels.openProofShell}
              </Button>
            ))}
          </>
        );
        return (
          <section key={engine.id}>
            <div style={pagePadding}>
              <h2>{engine.publicName}</h2>
              <p>{engine.mcpHandle}</p>
              <ul>
                {engine.runsIn.map((run) => (
                  <li key={run}>{runLabels[run]}</li>
                ))}
              </ul>
            </div>
            <ProofBlock presentation={pendingProofPresentation} />
            <div style={pagePadding}>
              {index === 0 ? (
                <MainActions>{actions}</MainActions>
              ) : (
                <div style={actionRow}>{actions}</div>
              )}
            </div>
          </section>
        );
      })}
      <section style={pagePadding}>
        <h2>{engineLabels.liveSamples}</h2>
        <p>{engineLabels.samplesPending}</p>
        <div style={actionRow}>
          <Button disabled>{engineLabels.trySample}</Button>
          <Button as="a" href="/plans" variant="secondary">
            {engineLabels.plans}
          </Button>
        </div>
      </section>
    </>
  );
}

/**
 * The scenario shell: only ids already found through the static route table
 * reach this screen. It renders the engine's name and MCP handle and the
 * registry's own publication state through the derivation — it never fetches
 * or resolves a package. A direct call with an unknown id fails closed to safe
 * copy and support; normal App routing sends unknown paths to the 404 page.
 */
export function ScenarioPage({ scenarioId }: { scenarioId: string }): JSX.Element {
  const scenario = engineScenarios.find((row) => row.scenarioId === scenarioId);
  const engine = scenario ? enginesById[scenario.engineId] : undefined;
  if (!scenario || !engine) {
    return (
      <section>
        <ProofBlock presentation={unknownScenarioPresentation} />
      </section>
    );
  }
  // F8: the registry row is the only source of the proof state — the page
  // renders what the data says and never fabricates a state, reason or play.
  const presentation = scenarioPresentation(scenario);
  return (
    <section>
      <div style={pagePadding}>
        <h2>{engine.publicName}</h2>
        <p>{engine.mcpHandle}</p>
      </div>
      <ProofBlock presentation={presentation} />
      <div style={pagePadding}>
        <MainActions>
          <Button as="a" href="/engines">
            {engineLabels.backToEngines}
          </Button>
        </MainActions>
      </div>
    </section>
  );
}
