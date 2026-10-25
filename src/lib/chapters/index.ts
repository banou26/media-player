// The chapter classifier behind Skip Opening and Skip Ending, for a page that decides what a chapter is without
// loading the player: this entry imports no React, no engine and no worker.
export { classifyChapters } from '../utils/chapters'
export type { ChapterKind } from '../utils/chapters'
export type { MediaChapter } from '../engine'
