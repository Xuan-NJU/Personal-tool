import type { AppSnapshot } from '../shared/types';

export type NoticeKind = 'success' | 'error' | 'info';
export type Notify = (message: string, kind?: NoticeKind) => void;
export type CommitSnapshot = (snapshot: AppSnapshot) => void;
