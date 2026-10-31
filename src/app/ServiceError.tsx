export type ServiceErrorStatus = 401 | 402 | 403 | 409 | 429 | 503;

export interface ServiceErrorProps {
  status: ServiceErrorStatus;
  requestRef: string;
  retryAfterSeconds?: number;
  lastCommitted?: { revision: string; time: string };
}

const messages: Record<ServiceErrorStatus, { happened: string; next: string }> = {
  401: {
    happened: 'You need to sign in to continue.',
    next: 'Sign in, then try the request again.',
  },
  402: {
    happened: 'The request needs available bank or credit.',
    next: 'Check your bank or credit before trying again.',
  },
  403: {
    happened: 'This capability is not available for the request.',
    next: 'Check the capability and access before trying again.',
  },
  409: {
    happened: 'The request conflicts with the current state.',
    next: 'Review the conflict before trying again.',
  },
  429: {
    happened: 'The service is busy.',
    next: 'Try again shortly.',
  },
  503: {
    happened: 'The service is recovering.',
    next: 'Try again after service recovery.',
  },
};

function safeToken(value: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ? value : null;
}

export function ServiceError({
  status,
  requestRef,
  retryAfterSeconds,
  lastCommitted,
}: ServiceErrorProps): JSX.Element {
  const message = messages[status];
  const reference = safeToken(requestRef) ?? 'not available';
  const hasRetryAfter = retryAfterSeconds !== undefined &&
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0;
  const next = status === 429 && hasRetryAfter
    ? `Try again after ${retryAfterSeconds} seconds.`
    : message.next;
  const revision = lastCommitted === undefined ? null : safeToken(lastCommitted.revision);
  const committedTime = lastCommitted !== undefined && Number.isFinite(Date.parse(lastCommitted.time))
    ? lastCommitted.time
    : null;
  return (
    <section aria-label="Service error">
      <p>{message.happened}</p>
      <p>{next}</p>
      <p>Request reference: {reference}</p>
      {revision !== null && committedTime !== null ? (
        <p>Last committed revision: {revision} at {committedTime}</p>
      ) : null}
    </section>
  );
}
