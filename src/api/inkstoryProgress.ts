/**
 * There is no cumulative ordinal: `number` restarts inside every volume and can
 * be fractional (`68.1` for an extra), so a position has to be counted.
 * GET /v2/chapters?bookId={id} returns every branch (translator) at once.
 */
export interface InkstoryChapter {
  id: string;
  branchId: string;
  volume: number;
  number: number;
}

/**
 * Total = the fullest branch; a read chapter's position is counted inside its
 * own branch — another branch can skip or add extras.
 */
export function readingStats(
  chapters: InkstoryChapter[],
  readChapterIds: string[]
): { chapter: number; lastChapterRead: number } {
  const branches = new Map<string, InkstoryChapter[]>();
  for (const chapter of chapters) {
    const branch = branches.get(chapter.branchId) ?? [];
    branch.push(chapter);
    branches.set(chapter.branchId, branch);
  }

  let chapter = 0;
  for (const branch of branches.values()) {
    branch.sort((a, b) => a.volume - b.volume || a.number - b.number);
    chapter = Math.max(chapter, branch.length);
  }

  let lastChapterRead = 0;
  for (const id of readChapterIds) {
    const read = chapters.find((c) => c.id === id);
    if (!read) continue;
    const position = branches.get(read.branchId)!.indexOf(read) + 1;
    lastChapterRead = Math.max(lastChapterRead, position);
  }

  return { chapter, lastChapterRead };
}

// ponytail: scans the whole page; in the server state only bookmarks carry
// `chapterId`. Anchor on `bookmarks:` if other objects start to.
export function parseBookmarkIds(html: string): string[] {
  return [...html.matchAll(/chapterId:"([0-9a-f-]{36})"/g)].map((m) => m[1]);
}
