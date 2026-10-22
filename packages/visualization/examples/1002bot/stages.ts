/**
 * Canonical stage catalogue shared by the adapter and public metadata exports.
 * Graph construction lives in `canonical-model.ts`; this module exposes the
 * canonical catalogue and public stage metadata.
 */

import { stages as canonicalStages } from './canonical-model.ts';

export const DOC_ROOT = '../docs/';
export const TUI_DOC_ROOT = '../.worktrees/TUI/docs/';

export const STAGES = canonicalStages;
export const STAGE_NAMES = { main: '主线', qq: 'QQ 接入线', tui: 'TUI 交互线' } as const;
