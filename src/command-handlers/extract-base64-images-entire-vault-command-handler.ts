import { noopAsync } from 'obsidian-dev-utils/async';
import { NonEditorCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/non-editor-command-handler';
import { t } from 'obsidian-dev-utils/obsidian/i18n/i18n';

import type { Plugin } from '../plugin.ts';

import { extractBase64ImagesEntireVault } from '../Base64Extractor.ts';

interface ExtractBase64ImagesEntireVaultCommandHandlerConstructorParams {
  readonly plugin: Plugin;
}

export class ExtractBase64ImagesEntireVaultCommandHandler extends NonEditorCommandHandler {
  private readonly plugin: Plugin;

  public constructor(params: ExtractBase64ImagesEntireVaultCommandHandlerConstructorParams) {
    super({
      icon: 'images',
      id: 'extract-base64-images-entire-vault',
      name: t(($) => $.commands.extractBase64ImagesEntireVault)
    });

    this.plugin = params.plugin;
  }

  protected override async execute(): Promise<void> {
    extractBase64ImagesEntireVault(this.plugin);
    return noopAsync();
  }
}
