// /s/:code. A share link opens the setup screen of its mode with the map's settings filled in. It never starts a play.

import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router';
import { Kicker, LinkButton, Notice, Panel } from '../components/ui';
import { isOlderGenerator, useGeneratorVersion } from '../state/generator';
import { readShareLink } from '../state/launch';
import type { SharedState } from '../state/launch';

export const SHARED_VERSION_NOTE = 'This link was made with a different map generator, so this seed makes a different map here than it did for the person who shared it.';

const NEWER_HELP = 'Reload the page to get the latest version, then open the link again.';
const INVALID_HELP = 'Check that the whole link was copied.';

export function Share() {
  const { code } = useParams();
  const link = useMemo(() => readShareLink(code), [code]);

  if (link.ok) {
    const state: SharedState = { prefill: link.launch, shared: { generatorVersion: link.generatorVersion } };
    return <Navigate to={link.path} replace state={state} />;
  }

  return (
    <Panel className="max-w-xl">
      <Kicker>Shared map</Kicker>
      <h1 className="mt-3 text-2xl">This link can't be opened</h1>
      <p className="mt-2" role="alert">
        {link.message}
      </p>
      <p className="mt-1 text-ink-2">{link.kind === 'newer' ? NEWER_HELP : INVALID_HELP}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <LinkButton to="/" variant="primary">
          Go home
        </LinkButton>
        <LinkButton to="/play">Open Play</LinkButton>
      </div>
    </Panel>
  );
}

/** Shown on a setup screen that a share link opened. */
export function SharedBanner({ generatorVersion }: { generatorVersion: number }) {
  const current = useGeneratorVersion();
  return (
    <Panel marks className="space-y-3 p-4 sm:p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Kicker>Shared map</Kicker>
        <p className="text-ink-2">The settings and the seed came from a link. Nothing starts until you press Start.</p>
      </div>
      {isOlderGenerator(generatorVersion, current) && <Notice tone="warn">{SHARED_VERSION_NOTE}</Notice>}
    </Panel>
  );
}
