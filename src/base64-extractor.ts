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
    operationFunction: (abortSignal) => extractBase64ImagesInAbstractFilesImpl(plugin, [plugin.app.vault.getRoot()], abortSignal, true),
    operationName: t(($) => $.commands.extractBase64ImagesEntireVault),
    shouldShowTimeoutNotice: false,
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
    operationFunction: (abortSignal) => extractBase64ImagesInAbstractFilesImpl(plugin, abstractFiles, abortSignal, true),
    operationName: t(($) => $.menuItems.extractBase64ImagesInFile),
    shouldShowTimeoutNotice: false,
    timeoutInMilliseconds: plugin.pluginSettingsComponent.settings.getTimeoutInMilliseconds()
  });
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const standardizedBase64 = base64.replaceAll('-', '+').replaceAll('_', '/');
  const binaryString = window.atob(standardizedBase64);
  const length_ = binaryString.length;
  const bytes = new Uint8Array(length_);
  for (let index = 0; index < length_; index++) {
    bytes[index] = binaryString.codePointAt(index) ?? 0;
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

  let isModified = false;
  const matches = [...content.matchAll(base64Regex)];

  if (matches.length === 0) {
    return 0;
  }

  for (const match of matches) {
    const { fullMatch, markdownLink } = await processBase64Match(app, note, match, abortSignal);
    if (markdownLink !== null) {
      const matchIndex = content.indexOf(fullMatch);
      if (matchIndex !== -1) {
        content = content.slice(0, matchIndex) + markdownLink + content.slice(matchIndex + fullMatch.length);
        isModified = true;
      }
    }
  }

  if (isModified) {
    await app.vault.modify(note, content);
  }
  return matches.length;
}

async function extractBase64ImagesInAbstractFilesImpl(plugin: Plugin, abstractFiles: TAbstractFile[], abortSignal: AbortSignal, isAlreadyConfirmed: boolean): Promise<void> {
  abortSignal.throwIfAborted();
  const singleFile: null | TFile = abstractFiles.length === 1 && isFile(abstractFiles[0]) ? abstractFiles[0] : null;

  if (singleFile && plugin.handedOverSettingsComponent.isPathIgnored(singleFile.path)) {
    new Notice(t(($) => $.notice.notePathIsIgnored));
    console.warn(`Cannot extract base64 images in the note as note path is ignored: ${singleFile.path}.`);
    return;
  }

  if (!isAlreadyConfirmed) {
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

  const noteFiles = [...noteFilesSet];
  noteFiles.sort((a, b) => a.path.localeCompare(b.path));

  const abortController = new AbortController();
  const combinedAbortSignal = abortSignalAny(abortController.signal, plugin.abortSignal, abortSignal);

  let totalExtracted = 0;

  await loop({
    abortSignal: combinedAbortSignal,
    buildNoticeMessage: ({ item, iterationString }) => t(($) => $.base64Extractor.progressBar.message, { iterationString, noteFilePath: item.path }),
    items: noteFiles,
    pluginNoticeComponent: plugin.pluginNoticeComponent,
    processItem: async (noteFile) => {
      combinedAbortSignal.throwIfAborted();
      if (plugin.handedOverSettingsComponent.isPathIgnored(noteFile.path)) {
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
  const base64Data = (match.groups?.['base64Data'] ?? '').replaceAll(/\s/g, '');
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
      markdownLink = markdownLink.startsWith('![[')
        ? markdownLink.replace(/^!\[\[(?<filename>[^\]|]+)(?:\|.*?)?\]\]/, (_match, filename) => `![[${String(filename)}|${altText}]]`)
        : markdownLink.replace(/^!\[.*?\]/, () => `![${altText}]`);
    }

    return { fullMatch, markdownLink };
  } catch (error) {
    console.warn(`Failed to process base64 image in file ${note.path}`, error);
    return { fullMatch, markdownLink: null };
  }
}
