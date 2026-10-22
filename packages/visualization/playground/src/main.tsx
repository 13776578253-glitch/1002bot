/**
 * Playground entry: loads the 1002bot adapter snapshots and renders the
 * EvolutionCanvas with a minimal stage switcher.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import type { TrackSeries } from '../../src/core/schema/types.ts';
import { assertValidTrackSeries } from '../../src/core/schema/validate.ts';
import { normalizeTracks } from '../../src/core/schema/normalize.ts';
import { ArchitectureBoard } from './board/ArchitectureBoard.tsx';
import '../../src/themes/default.css';
import data from './generated/bot-stages.json' with { type: 'json' };

const tracks = normalizeTracks(data.tracks as TrackSeries[]);
for (const track of tracks) assertValidTrackSeries(track);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ArchitectureBoard tracks={tracks} />
  </StrictMode>,
);
