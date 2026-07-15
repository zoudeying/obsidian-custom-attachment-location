import type {
  App,
  TAbstractFile,
  TFile
} from 'obsidian';

import {
  Notice,
  Vault
} from 'obsidian';
import { abortSignalAny } from 'obsidian-dev-utils/abort-controller';
import {
  isFile,
  isFolder,
  isNote
} from 'obsidian-dev-utils/obsidian/file-system';
import { appendCodeBlock } from 'obsidian-dev-utils/obsidian/html-element';
import { t } from 'obsidian-dev-utils/obsidian/i18n/i18n';
import { loop } from 'obsidian-dev-utils/obsidian/loop';
import { confirm } from 'obsidian-dev-utils/obsidian/modals/confirm';
import { addToQueue } from 'obsidian-dev-utils/obsidian/queue';

import type { Plugin } from './plugin.ts';

interface ProcessedMatchResult {
  readonly fullMatch: string;
  readonly markdownLink: null | string;
}

export async function extractBase64ImagesEntireVault(plugin: Plugin): Promise<void> {
  const canExtractBase64Images = await confirm({
    app: plugin.app,
    cancelButtonText: t(($) => $.obsidianDevUtils.buttons.cancel),
    message: createFragment((f) => {
      f.appendText(t(($) => $.base64Extractor.confirm.part1));
      f.createEl('br');
      f.appendText(t(($) => $.base64Extractor.confirm.part2));
    }),
    okButtonText: t(($) => $.obsidianDevUtils.buttons.ok),
    title: t(($) => $.commands.extractBase64ImagesEntireVault)
  });

  if (!canExtractBase64Images) {
    return;
  }

  addToQueue({
    abortSignal: plugin.abortSignal,
    operationFn: (abortSignal) => extractBase64ImagesInAbstractFilesImpl(plugin, [plugin.app.vault.getRoot()], abortSignal, true),
    operationName: t(($) => $.commands.extractBase64ImagesEntireVault),
    timeoutInMilliseconds: plugin.pluginSettingsComponent.settings.getTimeoutInMilliseconds()
  });
}

export async function extractBase64ImagesInAbstractFiles(plugin: Plugin, abstractFiles: TAbstractFile[]): Promise<void> {
  const singleFile: null | TFile = abstractFiles.length === 1 && isFile(abstractFiles[0]) ? abstractFiles[0] : null;

  let canExtract = !!singleFile;
  if (!canExtract) {
    canExtract = await confirm({
      app: plugin.app,
      cancelButtonText: t(($) => $.obsidianDevUtils.buttons.cancel),
      message: createFragment((f) => {
        f.appendText(t(($) => $.base64Extractor.confirm.part1));
        f.createEl('br');
        f.createEl('ul', {}, (ul) => {
          for (const abstractFile of abstractFiles) {
            ul.createEl('li', {}, (li) => {
              appendCodeBlock(li, abstractFile.path);
            });
          }
        });
        f.createEl('br');
        f.appendText(t(($) => $.base64Extractor.confirm.part2));
      }),
      okButtonText: t(($) => $.obsidianDevUtils.buttons.ok),
      title: t(($) => $.commands.extractBase64ImagesEntireVault)
    });
  }

  if (!canExtract) {
    return;
  }

  addToQueue({
    abortSignal: plugin.abortSignal,
    operationFn: (abortSignal) => extractBase64ImagesInAbstractFilesImpl(plugin, abstractFiles, abortSignal, true),
    operationName: t(($) => $.menuItems.extractBase64ImagesInFile),
    timeoutInMilliseconds: plugin.pluginSettingsComponent.settings.getTimeoutInMilliseconds()
  });
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const standardizedBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  const binaryString = window.atob(standardizedBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function extractBase64Images(
  plugin: Plugin,
  note: TFile,
  abortSignal: AbortSignal
): Promise<number> {
  abortSignal.throwIfAborted();
  const app = plugin.app;

  let content = await app.vault.read(note);
  // Support variations like charset, newlines, URL-safe base64, complex mime types, and malformed base64 strings
  const base64Regex = /!\[(?<altText>[\s\S]*?)\]\(\s*<?(?<fullData>data:(?:image\/(?<extension>[a-zA-Z0-9.\-+]+)|application\/octet-stream)[^,]*?;base64,(?<base64Data>[^)'"]+))>?(?:\s+['"](?<titleAttr>[^'"]*)['"])?\s*\)/g;

  let modified = false;
  const matches = [...content.matchAll(base64Regex)];

  if (matches.length === 0) {
    return 0;
  }

  for (const match of matches) {
    const { fullMatch, markdownLink } = await processBase64Match(app, note, match, abortSignal);
    if (markdownLink !== null) {
      const matchIndex = content.indexOf(fullMatch);
      if (matchIndex !== -1) {
        content = content.substring(0, matchIndex) + markdownLink + content.substring(matchIndex + fullMatch.length);
        modified = true;
      }
    }
  }

  if (modified) {
    await app.vault.modify(note, content);
  }
  return matches.length;
}

async function extractBase64ImagesInAbstractFilesImpl(plugin: Plugin, abstractFiles: TAbstractFile[], abortSignal: AbortSignal, alreadyConfirmed: boolean): Promise<void> {
  abortSignal.throwIfAborted();
  const singleFile: null | TFile = abstractFiles.length === 1 && isFile(abstractFiles[0]) ? abstractFiles[0] : null;

  if (singleFile && plugin.pluginSettingsComponent.settings.isPathIgnored(singleFile.path)) {
    new Notice(t(($) => $.notice.notePathIsIgnored));
    console.warn(`Cannot extract base64 images in the note as note path is ignored: ${singleFile.path}.`);
    return;
  }

  if (!alreadyConfirmed) {
    const canExtractBase64Images = !!singleFile || (await confirm({
      app: plugin.app,
      cancelButtonText: t(($) => $.obsidianDevUtils.buttons.cancel),
      message: createFragment((f) => {
        f.appendText(t(($) => $.base64Extractor.confirm.part1));
        f.createEl('br');
        f.createEl('ul', {}, (ul) => {
          for (const abstractFile of abstractFiles) {
            ul.createEl('li', {}, (li) => {
              appendCodeBlock(li, abstractFile.path);
            });
          }
        });
        f.createEl('br');
        f.appendText(t(($) => $.base64Extractor.confirm.part2));
      }),
      okButtonText: t(($) => $.obsidianDevUtils.buttons.ok),
      title: t(($) => $.commands.extractBase64ImagesEntireVault)
    }));

    if (!canExtractBase64Images) {
      abortSignal.throwIfAborted();
      return;
    }
  }

  const noteFilesSet = new Set<TFile>();

  for (const abstractFile of abstractFiles) {
    if (isFile(abstractFile) && isNote(abstractFile)) {
      noteFilesSet.add(abstractFile);
    }

    if (isFolder(abstractFile)) {
      Vault.recurseChildren(abstractFile, (child) => {
        if (isFile(child) && isNote(child)) {
          noteFilesSet.add(child);
        }
      });
    }
  }

  const noteFiles = Array.from(noteFilesSet);
  noteFiles.sort((a, b) => a.path.localeCompare(b.path));

  const abortController = new AbortController();
  const combinedAbortSignal = abortSignalAny(abortController.signal, plugin.abortSignal);

  let totalExtracted = 0;

  await loop({
    abortSignal: combinedAbortSignal,
    buildNoticeMessage: ({ item, iterationStr }) => t(($) => $.base64Extractor.progressBar.message, { iterationStr, noteFilePath: item.path }),
    items: noteFiles,
    pluginNoticeComponent: plugin.pluginNoticeComponent,
    processItem: async (noteFile) => {
      combinedAbortSignal.throwIfAborted();
      if (plugin.pluginSettingsComponent.settings.isPathIgnored(noteFile.path)) {
        return;
      }
      const count = await extractBase64Images(plugin, noteFile, combinedAbortSignal);
      totalExtracted += count;
    },
    progressBarTitle: `${plugin.manifest.name}: ${t(($) => $.base64Extractor.progressBar.title)}`,
    shouldContinueOnError: true,
    shouldShowProgressBar: true
  });

  if (totalExtracted === 0 && noteFiles.length === 1) {
    new Notice('No base64 images found in the selected file to extract.');
  } else if (totalExtracted > 0) {
    new Notice(`Successfully extracted ${String(totalExtracted)} base64 images.`);
  }
}

async function processBase64Match(
  app: App,
  note: TFile,
  match: RegExpMatchArray,
  abortSignal: AbortSignal
): Promise<ProcessedMatchResult> {
  abortSignal.throwIfAborted();
  const fullMatch = match[0];
  const altText = match.groups?.['altText'] ?? '';
  let extension = match.groups?.['extension'] ?? 'png';
  const base64Data = (match.groups?.['base64Data'] ?? '').replace(/\s/g, '');
  const titleAttr = match.groups?.['titleAttr'] ?? '';

  if (extension.toLowerCase() === 'jpeg') {
    extension = 'jpg';
  }

  let baseName = titleAttr || altText || `Pasted image ${window.moment().format('YYYYMMDDHHmmss')}`;

  if (baseName === 'image') {
    baseName = `Pasted image ${window.moment().format('YYYYMMDDHHmmss')}`;
  }

  if (baseName.endsWith(`.${extension}`)) {
    baseName = baseName.slice(0, -(extension.length + 1));
  }

  try {
    const arrayBuffer = base64ToArrayBuffer(base64Data);
    const attachmentFile = await app.saveAttachment(baseName, extension, arrayBuffer);
    let markdownLink = app.fileManager.generateMarkdownLink(attachmentFile, note.path);

    if (!markdownLink.startsWith('!')) {
      markdownLink = `!${markdownLink}`;
    }

    if (altText && altText !== baseName && markdownLink.startsWith('![')) {
      if (markdownLink.startsWith('![[')) {
        markdownLink = markdownLink.replace(/^!\[\[(?<filename>[^\]|]+)(?:\|.*?)?\]\]/, `![[$<filename>|${altText}]]`);
      } else {
        markdownLink = markdownLink.replace(/^!\[.*?\]/, `![${altText}]`);
      }
    }

    return { fullMatch, markdownLink };
  } catch (e) {
    console.warn(`Failed to process base64 image in file ${note.path}`, e);
    return { fullMatch, markdownLink: null };
  }
}
