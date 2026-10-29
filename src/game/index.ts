import type { CreateGame, PreviewLaunch, PlayTestSound } from '../shared/types';
export const ENGINE_VERSION = 1;
export const GENERATOR_VERSION = 1;
export const createGame: CreateGame = () => { throw new Error('createGame is not built yet'); };
export const previewLaunch: PreviewLaunch = () => { throw new Error('previewLaunch is not built yet'); };
export const playTestSound: PlayTestSound = () => {};
