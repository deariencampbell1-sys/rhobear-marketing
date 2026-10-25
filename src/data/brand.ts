// W0-02a: brand truth for the front door. Every user-visible string this file
// exports — the tagline, its explanation and the family line — is a locked
// fact sourced from lanes/README.md (see brandSources); nothing here invents
// claims. Route-ish strings carry a leading slash (enginesDestination).

export const brand = {
  name: 'RHOBEAR',
  tagline: 'Built by our own models.',
  taglineExplanation:
    'Every RHOBEAR app is built only by the four models customers get — Core, Peak, Summit and Guest — through our own pipeline. We planned it with help from Claude and Kimi K3, and our workers made it real.',
  familyLine:
    'Five apps on one account: Builds, Forge, Herald, Regent and Reviews, plus the Engines that run inside them.',
  appOrder: ['builds', 'forge', 'herald', 'regent', 'reviews'],
  enginesDestination: '/engines',
} as const;

// `as const` is type-only; freeze the object and its nested order array at runtime.
Object.freeze(brand.appOrder);
Object.freeze(brand);

// local until W0-02c composes the model
export const brandSources = {
  tagline: { doc: 'lanes/README.md', section: 'Locked facts every lane needs — The tagline' },
  taglineExplanation: { doc: 'lanes/README.md', section: 'Locked facts every lane needs — The tagline' },
  familyLine: { doc: 'lanes/README.md', section: 'Locked facts every lane needs — Five apps' },
} as const;
