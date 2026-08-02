/** Directory recursion depth cap — a stray drop of `/` shouldn't hang the tab. */
const MAX_DEPTH = 8;
/** Upper bound on files pulled out of one drop. */
const MAX_FILES = 200;

function entryFile(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(file),
      () => resolve(null),
    );
  });
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    reader.readEntries(
      (entries) => resolve(entries),
      () => resolve([]),
    );
  });
}

async function walk(entry: FileSystemEntry, out: File[], depth: number): Promise<void> {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;

  if (entry.isFile) {
    const file = await entryFile(entry as FileSystemFileEntry);
    if (file) out.push(file);
    return;
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries yields at most ~100 entries per call and signals the end with
    // an empty batch, so it has to be drained in a loop.
    for (;;) {
      const batch = await readBatch(reader);
      if (batch.length === 0) break;
      for (const child of batch) {
        await walk(child, out, depth + 1);
        if (out.length >= MAX_FILES) return;
      }
    }
  }
}

/**
 * Every file in a drop, descending into dropped folders.
 *
 * DataTransferItems are neutered as soon as the drop handler returns, so the
 * entries are captured synchronously up front and only then walked.
 */
export async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = [];
  const plainFiles: File[] = [];

  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      entries.push(entry);
    } else {
      // Browsers without the entries API still expose the flat file list.
      const file = item.getAsFile();
      if (file) plainFiles.push(file);
    }
  }

  if (entries.length === 0) {
    return plainFiles.length > 0 ? plainFiles : Array.from(dataTransfer.files ?? []);
  }

  const collected: File[] = [...plainFiles];
  for (const entry of entries) {
    await walk(entry, collected, 0);
    if (collected.length >= MAX_FILES) break;
  }
  return collected.slice(0, MAX_FILES);
}
