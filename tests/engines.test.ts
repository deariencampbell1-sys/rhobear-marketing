import { describe, expect, it } from 'vitest';
import {
  engineScenarios,
  engines,
  enginesById,
  enginesDestination,
} from '../src/data/engines';

const SOURCE = {
  doc: 'lanes/L9-front-door/INTENT.md',
  section: '3. Products — Engines',
};

const ENGINE_IDS = ['teams', 'designs', 'forge', 'capturd', 'vision', 'search', 'spaces'];

describe('engines registry', () => {
  it('has exactly the seven engines in order', () => {
    expect(engines.length).toBe(7);
    expect(engines.map((engine) => engine.id)).toEqual(ENGINE_IDS);
  });

  it('has unique engine ids', () => {
    const ids = engines.map((engine) => engine.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every engine both run targets', () => {
    for (const engine of engines) {
      expect(engine.runsIn, engine.id).toContain('builds-mini-app');
      expect(engine.runsIn, engine.id).toContain('mcp');
    }
  });

  it('derives every MCP handle from its id', () => {
    for (const engine of engines) {
      expect(engine.mcpHandle, engine.id).toBe(`@${engine.id}`);
    }
  });

  it('gives every engine at least one scenario named <id>-01', () => {
    for (const engine of engines) {
      expect(engine.scenarioIds.length, engine.id).toBeGreaterThanOrEqual(1);
      for (const scenarioId of engine.scenarioIds) {
        expect(scenarioId, engine.id).toBe(`${engine.id}-01`);
      }
    }
  });

  it('marks every engine as pending an approved demo', () => {
    for (const engine of engines) {
      expect(engine.descriptionState, engine.id).toBe('pending-approved-demo');
    }
  });

  it('cites the exact engines source for every engine', () => {
    for (const engine of engines) {
      expect(engine.source, engine.id).toEqual(SOURCE);
    }
  });
});

describe('enginesById', () => {
  it('has exactly the seven ids as own keys', () => {
    expect(Object.keys(enginesById)).toEqual(ENGINE_IDS);
    for (const id of ENGINE_IDS) {
      expect(Object.prototype.hasOwnProperty.call(enginesById, id), id).toBe(true);
    }
  });

  it('maps each id to the same object as the engines entry', () => {
    for (const engine of engines) {
      expect(enginesById[engine.id]).toBe(engine);
    }
  });

  it('has a null prototype so unknown ids cannot resolve', () => {
    expect(Object.getPrototypeOf(enginesById)).toBeNull();
    const byName = enginesById as unknown as Record<string, unknown>;
    expect(byName.constructor).toBeUndefined();
    expect(byName.toString).toBeUndefined();
  });

  it('is frozen', () => {
    expect(Object.isFrozen(enginesById)).toBe(true);
  });
});

describe('engineScenarios', () => {
  it('has one row per registered scenario id', () => {
    const expectedCount = engines.reduce((n, engine) => n + engine.scenarioIds.length, 0);
    expect(engineScenarios.length).toBe(expectedCount);
  });

  it('maps every row to the right engine id', () => {
    const expected = engines.flatMap((engine) =>
      engine.scenarioIds.map((scenarioId) => ({ scenarioId, engineId: engine.id })),
    );
    expect(
      engineScenarios.map(({ scenarioId, engineId }) => ({ scenarioId, engineId })),
    ).toEqual(expected);
  });

  it('marks every scenario as footage-pending with the exact source', () => {
    for (const scenario of engineScenarios) {
      expect(scenario.publicationState, scenario.scenarioId).toBe('footage-pending');
      expect(scenario.source, scenario.scenarioId).toEqual(SOURCE);
    }
  });

  it('has unique scenario ids', () => {
    const ids = engineScenarios.map((scenario) => scenario.scenarioId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('enginesDestination', () => {
  it('keeps the locked destination copy and source', () => {
    expect(enginesDestination).toEqual({
      id: 'engines',
      publicName: 'Engines',
      oneLiner: 'See the engine do real work.',
      whatItIs:
        'Engines are mini apps inside Builds plus @ MCPs for other harnesses. Every one is shown here by a real-speed recording of the product doing the work — never a mock, never a stock clip.',
      evidenceState: 'awaiting-approved-demos',
      source: SOURCE,
    });
  });
});
