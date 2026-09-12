import type { TAbstractFile } from 'obsidian';
import type { Promisable } from 'type-fest';

import { AbstractFileCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/abstract-file-command-handler';
import {
  isFile,
  isNote
} from 'obsidian-dev-utils/obsidian/file-system';
import { t } from 'obsidian-dev-utils/obsidian/i18n/i18n';

import type { Plugin } from '../plugin.ts';

import { extractBase64ImagesInAbstractFiles } from '../base64-extractor.ts';

interface ExtractBase64ImagesInFileCommandHandlerConstructorParams {
  readonly plugin: Plugin;
}

export class ExtractBase64ImagesInFileCommandHandler extends AbstractFileCommandHandler {
  private readonly plugin: Plugin;

  public constructor(params: ExtractBase64ImagesInFileCommandHandlerConstructorParams) {
    super({
      fileMenuItemName: t(($) => $.menuItems.extractBase64ImagesInFile),
      filesMenuItemName: t(($) => $.menuItems.extractBase64ImagesInFiles),
      icon: 'image-down',
      id: 'extract-base64-images-in-file',
      name: t(($) => $.commands.extractBase64ImagesCurrentNote)
    });

    this.plugin = params.plugin;
  }

  protected override canExecuteAbstractFiles(abstractFiles: TAbstractFile[]): boolean {
    if (!super.canExecute()) {
      return false;
    }

    for (const abstractFile of abstractFiles) {
      if (isFile(abstractFile) && !isNote(abstractFile)) {
        return false;
      }
    }

    return true;
  }

  protected override executeAbstractFile(abstractFile: TAbstractFile): Promisable<void> {
    return this.executeAbstractFiles([abstractFile]);
  }

  protected override async executeAbstractFiles(abstractFiles: TAbstractFile[]): Promise<void> {
    await extractBase64ImagesInAbstractFiles(this.plugin, abstractFiles);
  }

  protected override shouldAddToAbstractFileMenu(): boolean {
    return true;
  }

  protected override shouldAddToAbstractFilesMenu(): boolean {
    return true;
  }
}
