import type { TAbstractFile, TFile } from 'obsidian';

import { Notice, Vault } from 'obsidian';
import { abortSignalAny } from 'obsidian-dev-utils/AbortController';
import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import { isFile, isFolder, isNote } from 'obsidian-dev-utils/obsidian/FileSystem';
import { t } from 'obsidian-dev-utils/obsidian/i18n/i18n';
import { loop } from 'obsidian-dev-utils/obsidian/Loop';
import { confirm } from 'obsidian-dev-utils/obsidian/Modals/Confirm';
import { addToQueue } from 'obsidian-dev-utils/obsidian/Queue';

import type { Plugin } from './Plugin.ts';

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

export async function extractBase64Images(
    plugin: Plugin,
    note: TFile,
    abortSignal: AbortSignal
): Promise<number> {
    abortSignal.throwIfAborted();
    const app = plugin.app;

    let content = await app.vault.read(note);
    // Support variations like charset and newlines in base64 data
    const base64Regex = /!\[(.*?)\]\((data:image\/([a-zA-Z+]+)(?:;.*?)*?;base64,([a-zA-Z0-9+/=\s]+))(?:\s+"([^"]+)")?\)/g;

    let modified = false;
    const matches = [...content.matchAll(base64Regex)];

    if (matches.length === 0) {
        return 0;
    }

    for (const match of matches) {
        abortSignal.throwIfAborted();
        const fullMatch = match[0];
        const altText = match[1] || '';
        let extension = match[3] || 'png';
        // Remove spaces and newlines from base64 data
        const base64Data = (match[4] || '').replace(/\s/g, '');
        const titleAttr = match[5] || '';

        if (extension.toLowerCase() === 'jpeg') extension = 'jpg';

        let baseName = titleAttr || altText || `Pasted image ${window.moment().format('YYYYMMDDHHmmss')}`;

        // Ensure baseName is parsed through plugin's logic if possible, or at least keep "Pasted image" format 
        // if alt text is 'image' or not provided to allow AttachmentRenameMode to trigger.
        if (baseName === 'image') {
            baseName = `Pasted image ${window.moment().format('YYYYMMDDHHmmss')}`;
        }

        // Clean baseName from extension if it exists since saveAttachment takes name and ext separately.
        if (baseName.endsWith(`.${extension}`)) {
            baseName = baseName.slice(0, -(extension.length + 1));
        }

        try {
            const arrayBuffer = base64ToArrayBuffer(base64Data);

            // Save the attachment using plugin's hacked standard saveAttachment logic (which honors paths)
            const attachmentFile = await app.saveAttachment(baseName, extension, arrayBuffer);

            // Generate markdown link
            let markdownLink = app.fileManager.generateMarkdownLink(attachmentFile, note.path);

            if (!markdownLink.startsWith('!')) {
                markdownLink = '!' + markdownLink;
            }

            // Inherit the alt text if there is one that's meaningful, and substitute the markdown link
            // if generateMarkdownLink gave generic markdown link but we want alt
            if (altText && altText !== baseName && markdownLink.startsWith('![')) {
                // Determine if it's a wikilink ![[...]] or standard link ![](...)
                if (markdownLink.startsWith('![[')) {
                    // Extract the filename part and any existing alias part.
                    // E.g. ![[file.png]] -> $1=file.png, $2=undefined
                    // E.g. ![[file.png|oldAlias]] -> $1=file.png, $2=|oldAlias
                    markdownLink = markdownLink.replace(/^!\[\[([^\]|]+)(?:\|.*?)?\]\]/, `![[$1|${altText}]]`);
                } else {
                    markdownLink = markdownLink.replace(/^!\[.*?\]/, `![${altText}]`);
                }
            }

            // Using string replace only replaces the first match, but if we have multiple 
            // IDENTICAL base64 matches, replacing the first one again will break. 
            // Also, functional replacer avoids `$` being interpreted in markdownLink.
            // But we must only replace the specific match at its specific index. Since we are in a loop,
            // we will replace the full text, but we must only replace one occurrence at a time.
            let matchIndex = content.indexOf(fullMatch);
            if (matchIndex !== -1) {
                content = content.substring(0, matchIndex) + markdownLink + content.substring(matchIndex + fullMatch.length);
                modified = true;
            }
        } catch (e) {
            console.warn(`Failed to process base64 image in file ${note.path}`, e);
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

    if (singleFile && plugin.settings.isPathIgnored(singleFile.path)) {
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
        if (isFile(abstractFile) && isNote(plugin.app, abstractFile)) {
            noteFilesSet.add(abstractFile);
        }

        if (isFolder(abstractFile)) {
            Vault.recurseChildren(abstractFile, (child) => {
                if (isFile(child) && isNote(plugin.app, child)) {
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
        buildNoticeMessage: (noteFile, iterationStr) => t(($) => $.base64Extractor.progressBar.message, { iterationStr, noteFilePath: noteFile.path }),
        items: noteFiles,
        processItem: async (noteFile) => {
            combinedAbortSignal.throwIfAborted();
            if (plugin.settings.isPathIgnored(noteFile.path)) {
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
        new Notice(`Successfully extracted ${totalExtracted} base64 images.`);
    }
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

    if (!canExtractBase64Images) return;

    addToQueue({
        abortSignal: plugin.abortSignal,
        app: plugin.app,
        operationFn: (abortSignal) => extractBase64ImagesInAbstractFilesImpl(plugin, [plugin.app.vault.getRoot()], abortSignal, true),
        operationName: t(($) => $.commands.extractBase64ImagesEntireVault),
        timeoutInMilliseconds: plugin.settings.getTimeoutInMilliseconds()
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

    if (!canExtract) return;

    addToQueue({
        abortSignal: plugin.abortSignal,
        app: plugin.app,
        operationFn: (abortSignal) => extractBase64ImagesInAbstractFilesImpl(plugin, abstractFiles, abortSignal, true),
        operationName: t(($) => $.menuItems.extractBase64ImagesInFile),
        timeoutInMilliseconds: plugin.settings.getTimeoutInMilliseconds()
    });
}
