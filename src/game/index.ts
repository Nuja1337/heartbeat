// The public face of the game engine. The app imports only from here.

import type { CreateGame, CreatePlayback, MapPreview, PlayTestSound, PreviewLaunch } from '../shared/types';
import { playTestSound as playTest } from './audio/audio';
import { createGameImpl } from './engine/game';
import { extendFeatures } from './map/features';
import { setupPlay } from './modes/runner';
import { createPlayback as createPlaybackImpl } from './replay/playback';

export { ENGINE_VERSION, GENERATOR_VERSION } from './version';

export const createGame: CreateGame = createGameImpl;

/** Plays a recorded replay, or a simulated player, on a canvas. See PlaybackHandle. */
export const createPlayback: CreatePlayback = createPlaybackImpl;

/** The map a launch would play, with its features. Adaptive modes return the first set. Synchronous. */
export const previewLaunch: PreviewLaunch = (launch): MapPreview => {
  const setup = setupPlay(launch);
  const features: MapPreview['features'] = [];
  extendFeatures(setup.map.objects, features, 0, setup.progressMs);
  return { map: setup.map, features };
};

export const playTestSound: PlayTestSound = playTest;
