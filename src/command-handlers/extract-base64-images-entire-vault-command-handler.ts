import { GlobalCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/global-command-handler';
import { t } from 'obsidian-dev-utils/obsidian/i18n/i18n';

import type { Plugin } from '../plugin.ts';

import { extractBase64ImagesEntireVault } from '../base64-extractor.ts';

interface ExtractBase64ImagesEntireVaultCommandHandlerConstructorParams {
  readonly plugin: Plugin;
}

export class ExtractBase64ImagesEntireVaultCommandHandler extends GlobalCommandHandler {
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
    await extractBase64ImagesEntireVault(this.plugin);
  }
}
