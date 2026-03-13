import type { TAbstractFile } from 'obsidian';

import {
    AbstractFileCommandBase,
    AbstractFileCommandInvocationBase,
    AbstractFilesCommandInvocationBase,
    ArrayDelegatingAbstractFileCommandInvocation
} from 'obsidian-dev-utils/obsidian/Commands/AbstractFileCommandBase';
import {
    isFile,
    isNote
} from 'obsidian-dev-utils/obsidian/FileSystem';
import { t } from 'obsidian-dev-utils/obsidian/i18n/i18n';

import type { Plugin } from '../Plugin.ts';

import { extractBase64ImagesInAbstractFiles } from '../Base64Extractor.ts';

class ExtractBase64ImagesInFilesCommandInvocation extends AbstractFilesCommandInvocationBase<Plugin> {
    public constructor(plugin: Plugin, abstractFiles: TAbstractFile[]) {
        super(plugin, abstractFiles);
    }

    protected override canExecute(): boolean {
        if (!super.canExecute()) {
            return false;
        }

        for (const abstractFile of this.abstractFiles) {
            if (isFile(abstractFile) && !isNote(this.app, abstractFile)) {
                return false;
            }
        }

        return true;
    }

    protected override async execute(): Promise<void> {
        extractBase64ImagesInAbstractFiles(this.plugin, this.abstractFiles);
    }
}

export class ExtractBase64ImagesInFileCommand extends AbstractFileCommandBase<Plugin> {
    public constructor(plugin: Plugin) {
        super({
            fileMenuItemName: t(($) => $.menuItems.extractBase64ImagesInFile),
            filesMenuItemName: t(($) => $.menuItems.extractBase64ImagesInFiles),
            icon: 'image-down',
            id: 'extract-base64-images-in-file',
            name: t(($) => $.commands.extractBase64ImagesCurrentNote),
            plugin
        });
    }

    protected override createCommandInvocationForAbstractFile(file: null | TAbstractFile): AbstractFileCommandInvocationBase<Plugin> {
        return new ArrayDelegatingAbstractFileCommandInvocation(this.plugin, file, this.createCommandInvocationForAbstractFiles.bind(this));
    }

    protected override createCommandInvocationForAbstractFiles(abstractFiles: TAbstractFile[]): AbstractFilesCommandInvocationBase<Plugin> {
        return new ExtractBase64ImagesInFilesCommandInvocation(this.plugin, abstractFiles);
    }

    protected override shouldAddToAbstractFileMenu(): boolean {
        return true;
    }

    protected override shouldAddToAbstractFilesMenu(): boolean {
        return true;
    }
}
