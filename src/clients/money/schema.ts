// W0-03a: hand-written wire validation for the L2 money endpoints — no zod,
// no coercion, no arithmetic. Each parser returns a new object containing
// only the declared keys (allowlist, not passthrough), which is how the site
// guarantees it can never render provider cost or margin: unknown fields like
// providerCost, markup or stripeFee are dropped here, before any screen sees
// them. Every parser fails closed to null; the caller maps null to a truthful
// fallback state (e.g. EntitlementState 'unknown').

/** Decimal string, e.g. '23.99'. A JS number is never money. */
export type Money = string;

export type CatalogPlan = {
  sku: string;
  name: string;
  monthlyPrice: Money;
  creditIncluded: Money;
  runtime?: string;
  availability: 'available' | 'unavailable';
  reason?: string;
};

export type CatalogCapability = {
  product: string;
  capability: string;
  plans: readonly string[];
  state: 'included' | 'not-included' | 'unknown';
};

export type Catalog = {
  schema: 'rhobear.catalog.v1';
  catalogVersion: string;
  sourceSha: string;
  currency: 'USD';
  region: 'US';
  plans: readonly CatalogPlan[];
  capabilities: readonly CatalogCapability[];
  generatedAt: string;
};

export type Quote = {
  operationId: string;
  accountUuid: string;
  catalogVersion: string;
  sourceSha: string;
  sku: string;
  channel: 'web' | 'apple' | 'google';
  price: Money;
  credit: Money;
  tax: Money;
  total: Money; // required — never recomputed client-side
  currency: 'USD';
  renewal: 'monthly';
  paidThroughRule: string;
  createdAt: string;
  expiresAt: string;
};

export type EntitlementState =
  | 'active'
  | 'free-local'
  | 'pending'
  | 'past-due'
  | 'canceled-until-paid-through'
  | 'grace'
  | 'expired'
  | 'conflict'
  | 'unknown';

export type Entitlement = {
  accountUuid: string;
  product: string;
  capability: string;
  plan: string;
  channel: 'web' | 'apple' | 'google';
  state: EntitlementState;
  paidThrough: string | null;
  catalogVersion: string;
  revision: number;
};

export type BankState = 'available' | 'low' | 'empty' | 'reconciling';

export type Bank = {
  revision: number;
  currency: 'USD';
  creditAvailable: Money;
  creditReserved: Money;
  allowanceRemaining: Money;
  purchasedRemaining: Money;
  resetsAt: string;
  state: BankState;
};

export const MONEY_PATTERN: RegExp = /^\d{1,9}\.\d{2}$/;

export function isMoney(v: unknown): v is Money {
  return typeof v === 'string' && MONEY_PATTERN.test(v);
}

const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Parseable date with an explicit timezone — no timezone-less strings. */
export function isRfc3339(v: unknown): boolean {
  if (typeof v !== 'string' || !RFC3339_PATTERN.test(v)) return false;
  return !isNaN(Date.parse(v));
}

export function isSha40(v: unknown): boolean {
  return typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseCatalogPlan(raw: unknown): CatalogPlan | null {
  if (!isRecord(raw)) return null;
  const sku = raw.sku;
  const name = raw.name;
  const monthlyPrice = raw.monthlyPrice;
  const creditIncluded = raw.creditIncluded;
  const runtime = raw.runtime;
  const availability = raw.availability;
  const reason = raw.reason;
  if (typeof sku !== 'string' || sku.length === 0) return null;
  if (typeof name !== 'string') return null;
  if (!isMoney(monthlyPrice)) return null;
  if (!isMoney(creditIncluded)) return null;
  if (runtime !== undefined && typeof runtime !== 'string') return null;
  if (availability !== 'available' && availability !== 'unavailable') return null;
  if (reason !== undefined && typeof reason !== 'string') return null;
  return {
    sku,
    name,
    monthlyPrice,
    creditIncluded,
    availability,
    ...(runtime !== undefined ? { runtime } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

function parseCatalogCapability(raw: unknown): CatalogCapability | null {
  if (!isRecord(raw)) return null;
  const product = raw.product;
  const capability = raw.capability;
  const plans = raw.plans;
  const state = raw.state;
  if (typeof product !== 'string' || product.length === 0) return null;
  if (typeof capability !== 'string' || capability.length === 0) return null;
  if (!Array.isArray(plans)) return null;
  const planIds: string[] = [];
  for (const id of plans) {
    if (typeof id !== 'string' || id.length === 0) return null;
    planIds.push(id);
  }
  if (state !== 'included' && state !== 'not-included' && state !== 'unknown') return null;
  return { product, capability, plans: planIds, state };
}

export function parseCatalog(raw: unknown): Catalog | null {
  if (!isRecord(raw)) return null;
  const schema = raw.schema;
  const catalogVersion = raw.catalogVersion;
  const sourceSha = raw.sourceSha;
  const currency = raw.currency;
  const region = raw.region;
  const generatedAt = raw.generatedAt;
  const plansRaw = raw.plans;
  const capabilitiesRaw = raw.capabilities;
  if (schema !== 'rhobear.catalog.v1') return null;
  if (typeof catalogVersion !== 'string' || catalogVersion.length === 0) return null;
  if (typeof sourceSha !== 'string' || !isSha40(sourceSha)) return null;
  if (currency !== 'USD') return null;
  if (region !== 'US') return null;
  if (typeof generatedAt !== 'string' || !isRfc3339(generatedAt)) return null;
  if (!Array.isArray(plansRaw) || plansRaw.length === 0) return null;
  if (!Array.isArray(capabilitiesRaw)) return null;
  const plans: CatalogPlan[] = [];
  for (const entry of plansRaw) {
    const plan = parseCatalogPlan(entry);
    if (plan === null) return null;
    plans.push(plan);
  }
  const capabilities: CatalogCapability[] = [];
  for (const entry of capabilitiesRaw) {
    const capability = parseCatalogCapability(entry);
    if (capability === null) return null;
    capabilities.push(capability);
  }
  // Allowlist: a fresh object with only the declared keys.
  return {
    schema: 'rhobear.catalog.v1',
    catalogVersion,
    sourceSha,
    currency: 'USD',
    region: 'US',
    plans,
    capabilities,
    generatedAt,
  };
}

export function parseQuote(raw: unknown): Quote | null {
  if (!isRecord(raw)) return null;
  const operationId = raw.operationId;
  const accountUuid = raw.accountUuid;
  const catalogVersion = raw.catalogVersion;
  const sourceSha = raw.sourceSha;
  const sku = raw.sku;
  const channel = raw.channel;
  const price = raw.price;
  const credit = raw.credit;
  const tax = raw.tax;
  const total = raw.total;
  const currency = raw.currency;
  const renewal = raw.renewal;
  const paidThroughRule = raw.paidThroughRule;
  const createdAt = raw.createdAt;
  const expiresAt = raw.expiresAt;
  if (typeof operationId !== 'string' || operationId.length === 0) return null;
  if (typeof accountUuid !== 'string' || accountUuid.length === 0) return null;
  if (typeof catalogVersion !== 'string' || catalogVersion.length === 0) return null;
  if (typeof sourceSha !== 'string' || !isSha40(sourceSha)) return null;
  if (typeof sku !== 'string' || sku.length === 0) return null;
  if (channel !== 'web' && channel !== 'apple' && channel !== 'google') return null;
  if (!isMoney(price)) return null;
  if (!isMoney(credit)) return null;
  if (!isMoney(tax)) return null;
  if (!isMoney(total)) return null; // total is required; never recomputed
  if (currency !== 'USD') return null;
  if (renewal !== 'monthly') return null;
  if (typeof paidThroughRule !== 'string') return null;
  if (typeof createdAt !== 'string') return null;
  if (typeof expiresAt !== 'string' || !isRfc3339(expiresAt)) return null;
  return {
    operationId,
    accountUuid,
    catalogVersion,
    sourceSha,
    sku,
    channel,
    price,
    credit,
    tax,
    total,
    currency: 'USD',
    renewal: 'monthly',
    paidThroughRule,
    createdAt,
    expiresAt,
  };
}

export function parseEntitlement(raw: unknown): Entitlement | null {
  if (!isRecord(raw)) return null;
  const accountUuid = raw.accountUuid;
  const product = raw.product;
  const capability = raw.capability;
  const plan = raw.plan;
  const channel = raw.channel;
  const state = raw.state;
  const paidThrough = raw.paidThrough;
  const catalogVersion = raw.catalogVersion;
  const revision = raw.revision;
  if (typeof accountUuid !== 'string' || accountUuid.length === 0) return null;
  if (typeof product !== 'string' || product.length === 0) return null;
  if (typeof capability !== 'string' || capability.length === 0) return null;
  if (typeof plan !== 'string' || plan.length === 0) return null;
  if (channel !== 'web' && channel !== 'apple' && channel !== 'google') return null;
  if (
    state !== 'active' &&
    state !== 'free-local' &&
    state !== 'pending' &&
    state !== 'past-due' &&
    state !== 'canceled-until-paid-through' &&
    state !== 'grace' &&
    state !== 'expired' &&
    state !== 'conflict' &&
    state !== 'unknown'
  ) {
    return null;
  }
  if (paidThrough !== null && typeof paidThrough !== 'string') return null;
  if (typeof catalogVersion !== 'string' || catalogVersion.length === 0) return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
    return null; // a response missing a positive revision is not an entitlement
  }
  return {
    accountUuid,
    product,
    capability,
    plan,
    channel,
    state,
    paidThrough,
    catalogVersion,
    revision,
  };
}

export function parseBank(raw: unknown): Bank | null {
  if (!isRecord(raw)) return null;
  const revision = raw.revision;
  const currency = raw.currency;
  const creditAvailable = raw.creditAvailable;
  const creditReserved = raw.creditReserved;
  const allowanceRemaining = raw.allowanceRemaining;
  const purchasedRemaining = raw.purchasedRemaining;
  const resetsAt = raw.resetsAt;
  const state = raw.state;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null;
  if (currency !== 'USD') return null;
  if (!isMoney(creditAvailable)) return null;
  if (!isMoney(creditReserved)) return null;
  if (!isMoney(allowanceRemaining)) return null;
  if (!isMoney(purchasedRemaining)) return null;
  if (typeof resetsAt !== 'string') return null;
  if (state !== 'available' && state !== 'low' && state !== 'empty' && state !== 'reconciling') {
    return null;
  }
  return {
    revision,
    currency: 'USD',
    creditAvailable,
    creditReserved,
    allowanceRemaining,
    purchasedRemaining,
    resetsAt,
    state,
  };
}
