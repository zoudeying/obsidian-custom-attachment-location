import { CommandInvocationBase } from 'obsidian-dev-utils/obsidian/Commands/CommandBase';
import { NonEditorCommandBase } from 'obsidian-dev-utils/obsidian/Commands/NonEditorCommandBase';
import { t } from 'obsidian-dev-utils/obsidian/i18n/i18n';

import type { Plugin } from '../Plugin.ts';

import { extractBase64ImagesEntireVault } from '../Base64Extractor.ts';

class ExtractBase64ImagesEntireVaultCommandInvocation extends CommandInvocationBase<Plugin> {
    public constructor(plugin: Plugin) {
        super(plugin);
    }

    protected override async execute(): Promise<void> {
        extractBase64ImagesEntireVault(this.plugin);
        await Promise.resolve();
    }
}

export class ExtractBase64ImagesEntireVaultCommand extends NonEditorCommandBase<Plugin> {
    public constructor(plugin: Plugin) {
        super({
            icon: 'images',
            id: 'extract-base64-images-entire-vault',
            name: t(($) => $.commands.extractBase64ImagesEntireVault),
            plugin
        });
    }

    protected override createCommandInvocation(): CommandInvocationBase {
        return new ExtractBase64ImagesEntireVaultCommandInvocation(this.plugin);
    }
}
