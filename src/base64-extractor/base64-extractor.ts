import type {
  App,
  TAbstractFile,
  TFile
} from 'obsidian';

import {
  isFile,
  isFolder,
  isNote
} from '@mnaoumov/obsidian-lib/file-system';
import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';
import { t } from '@mnaoumov/obsidian-lib/i18n/i18n';
import { loop } from '@mnaoumov/obsidian-lib/loop';
import { confirm } from '@mnaoumov/obsidian-lib/modals/confirm';
import { addToQueue } from '@mnaoumov/obsidian-lib/queue';
import { abortSignalAny } from '@mnaoumov/typescript-lib/abort-controller';
import {
  Notice,
  Vault
} from 'obsidian';

import type { Plugin } from '../plugin.ts';

export interface ExtractBase64ImagesInFileOptions {
  readonly abortSignal?: AbortSignal;
  readonly shouldShowNotice?: boolean;
}

interface Base64ImageTarget {
  readonly altText: string;
  readonly base64Data: string;
  readonly extension: string;
  readonly fullMatch: string;
  readonly titleAttr: string;
}

interface HtmlImgAttributes {
  readonly altText: string;
  readonly titleAttr: string;
}

interface ProcessedMatchResult {
  readonly fullMatch: string;
  readonly markdownLink: null | string;
}

const HTML_IMG_BASE64_REGEX = /<img\s+[^>]*?src\s*=\s*['"](?<fullData>data:(?:image\/(?<extension>[a-zA-Z0-9.\-+]+)|application\/octet-stream)[^,]*?;base64,(?<base64Data>[^'"]+))['"][^>]*?\/?>/gi;
const MARKDOWN_BASE64_REGEX = /!\[(?<altText>[\s\S]*?)\]\(\s*<?(?<fullData>data:(?:image\/(?<extension>[a-zA-Z0-9.\-+]+)|application\/octet-stream)[^,]*?;base64,(?<base64Data>[^)'"]+))>?(?:\s+['"](?<titleAttr>[^'"]*)['"])?\s*\)/g;

export async function extractBase64ImagesEntireVault(plugin: Plugin): Promise<void> {
  const canExtractBase64Images = await confirm({
    app: plugin.app,
    cancelButtonText: t(($) => $.obsidianLib.buttons.cancel),
    message: createFragment((f) => {
      f.appendText(t(($) => $.base64Extractor.confirm.part1));
      f.createEl('br');
      f.appendText(t(($) => $.base64Extractor.confirm.part2));
    }),
    okButtonText: t(($) => $.obsidianLib.buttons.ok),
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
      cancelButtonText: t(($) => $.obsidianLib.buttons.cancel),
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
      okButtonText: t(($) => $.obsidianLib.buttons.ok),
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

export async function extractBase64ImagesInFile(
  plugin: Plugin,
  note: TFile,
  options?: ExtractBase64ImagesInFileOptions
): Promise<number> {
  const abortSignal = options?.abortSignal ?? plugin.abortSignal;
  const shouldShowNotice = options?.shouldShowNotice ?? false;

  if (plugin.handedOverSettingsComponent.isPathIgnored(note.path)) {
    return 0;
  }

  const count = await extractBase64Images(plugin, note, abortSignal);
  if (count > 0 && shouldShowNotice) {
    new Notice(t(($) => $.base64Extractor.autoExtractedNotice, { count, noteFileName: note.basename }));
  }
  return count;
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

function collectBase64ImageTargets(content: string): Base64ImageTarget[] {
  const markdownTargets = Array.from(content.matchAll(MARKDOWN_BASE64_REGEX), (match): Base64ImageTarget => ({
    altText: match.groups?.['altText'] ?? '',
    base64Data: (match.groups?.['base64Data'] ?? '').replaceAll(/\s/g, ''),
    extension: match.groups?.['extension'] ?? 'png',
    fullMatch: match[0],
    titleAttr: match.groups?.['titleAttr'] ?? ''
  }));

  const htmlTargets = Array.from(content.matchAll(HTML_IMG_BASE64_REGEX), (match): Base64ImageTarget => {
    const { altText, titleAttr } = parseHtmlImgAttributes(match[0]);
    return {
      altText,
      base64Data: (match.groups?.['base64Data'] ?? '').replaceAll(/\s/g, ''),
      extension: match.groups?.['extension'] ?? 'png',
      fullMatch: match[0],
      titleAttr
    };
  });

  return [...markdownTargets, ...htmlTargets];
}

async function extractBase64Images(
  plugin: Plugin,
  note: TFile,
  abortSignal: AbortSignal
): Promise<number> {
  abortSignal.throwIfAborted();
  const app = plugin.app;

  let content = await app.vault.read(note);
  if (!content.includes('data:image/') && !content.includes('data:application/octet-stream')) {
    return 0;
  }

  const targets = collectBase64ImageTargets(content);
  if (targets.length === 0) {
    return 0;
  }

  let isModified = false;
  const results: ProcessedMatchResult[] = [];
  for (const target of targets) {
    abortSignal.throwIfAborted();
    const result = await processBase64Target(app, note, target, abortSignal);
    results.push(result);
  }

  for (const { fullMatch, markdownLink } of results) {
    if (markdownLink === null || !content.includes(fullMatch)) {
      continue;
    }

    content = content.replace(fullMatch, () => markdownLink);
    isModified = true;
  }

  if (isModified) {
    await app.vault.modify(note, content);
  }

  return results.filter((r) => r.markdownLink !== null).length;
}

async function extractBase64ImagesInAbstractFilesImpl(
  plugin: Plugin,
  abstractFiles: TAbstractFile[],
  abortSignal: AbortSignal,
  isAlreadyConfirmed = false
): Promise<void> {
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
      cancelButtonText: t(($) => $.obsidianLib.buttons.cancel),
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
      okButtonText: t(($) => $.obsidianLib.buttons.ok),
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

function parseHtmlImgAttributes(html: string): HtmlImgAttributes {
  const altMatch = /\balt\s*=\s*['"](?<alt>[^'"]*)['"]/i.exec(html);
  const titleMatch = /\btitle\s*=\s*['"](?<title>[^'"]*)['"]/i.exec(html);
  return {
    altText: altMatch?.groups?.['alt'] ?? '',
    titleAttr: titleMatch?.groups?.['title'] ?? ''
  };
}

async function processBase64Target(
  app: App,
  note: TFile,
  target: Base64ImageTarget,
  abortSignal: AbortSignal
): Promise<ProcessedMatchResult> {
  abortSignal.throwIfAborted();
  const fullMatch = target.fullMatch;
  const altText = target.altText;
  let extension = target.extension;
  const base64Data = target.base64Data;
  const titleAttr = target.titleAttr;

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
