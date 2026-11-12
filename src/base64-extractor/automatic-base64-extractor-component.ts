/**
 * @file
 *
 * `Extract base64 images automatically`: automatically detects embedded base64 images
 * and converts them into physical attachments when notes are created or modified.
 */

import type {
  App,
  TAbstractFile,
  TFile
} from 'obsidian';

import { LayoutReadyComponent } from '@mnaoumov/obsidian-lib/components/layout-ready-component';
import { isFile } from '@mnaoumov/obsidian-lib/file-system';
import { invokeAsyncSafely } from '@mnaoumov/typescript-lib/async';

import type { Plugin } from '../plugin.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import { extractBase64ImagesInFile } from './base64-extractor.ts';

const CREATE_DELAY_IN_MILLISECONDS = 100;
const MODIFY_DEBOUNCE_IN_MILLISECONDS = 800;

interface AutomaticBase64ExtractorComponentConstructorParams {
  readonly app: App;
  readonly plugin: Plugin;
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

/**
 * Automatically extracts base64 images whenever a note is created or changed, while the setting is on.
 */
export class AutomaticBase64ExtractorComponent extends LayoutReadyComponent {
  private readonly pendingTimers = new Map<string, number>();
  private readonly plugin: Plugin;
  private readonly pluginSettingsComponent: PluginSettingsComponent;
  private readonly processingFilePaths = new Set<string>();

  public constructor(params: AutomaticBase64ExtractorComponentConstructorParams) {
    super(params.app);
    this.plugin = params.plugin;
    this.pluginSettingsComponent = params.pluginSettingsComponent;
  }

  public override onunload(): void {
    super.onunload();
    for (const timer of this.pendingTimers.values()) {
      window.clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.processingFilePaths.clear();
  }

  /**
   * Starts listening once the layout is ready, so initial vault indexing does not scan every note.
   */
  protected override onLayoutReady(): void {
    this.registerEvent(this.app.vault.on('create', this.handleFileCreated.bind(this)));
    this.registerEvent(this.app.metadataCache.on('changed', this.handleMetadataCacheChanged.bind(this)));
  }

  private handleFileCreated(abstractFile: TAbstractFile): void {
    if (
      !this.pluginSettingsComponent.settings.shouldExtractBase64ImagesAutomatically
      || !isFile(abstractFile)
      || !this.pluginSettingsComponent.isNoteEx(abstractFile)
      || this.plugin.handedOverSettingsComponent.isPathIgnored(abstractFile.path)
    ) {
      return;
    }

    this.scheduleProcessing(abstractFile, CREATE_DELAY_IN_MILLISECONDS);
  }

  private handleMetadataCacheChanged(file: TFile): void {
    if (
      !this.pluginSettingsComponent.settings.shouldExtractBase64ImagesAutomatically
      || !this.pluginSettingsComponent.isNoteEx(file)
      || this.plugin.handedOverSettingsComponent.isPathIgnored(file.path)
      || this.processingFilePaths.has(file.path)
    ) {
      return;
    }

    /*
     * The link suggester is open, so the user is in the middle of typing a link.
     */
    const suggestionContainer = activeDocument.querySelector<HTMLDivElement>('.suggestion-container');
    if (suggestionContainer?.isShown()) {
      return;
    }

    this.scheduleProcessing(file, MODIFY_DEBOUNCE_IN_MILLISECONDS);
  }

  private async processFile(file: TFile): Promise<void> {
    if (this.processingFilePaths.has(file.path) || this.plugin.handedOverSettingsComponent.isPathIgnored(file.path)) {
      return;
    }

    let content: string;
    try {
      content = await this.app.vault.read(file);
    } catch {
      return;
    }

    // Ultra-fast guard check: if no base64 indicator, exit immediately without regex parsing.
    if (!content.includes('data:image/') && !content.includes('data:application/octet-stream')) {
      return;
    }

    this.processingFilePaths.add(file.path);
    try {
      await extractBase64ImagesInFile(this.plugin, file, { shouldShowNotice: true });
    } catch (error) {
      console.error(`Failed to automatically extract base64 images in ${file.path}:`, error);
    } finally {
      this.processingFilePaths.delete(file.path);
    }
  }

  private scheduleProcessing(file: TFile, delayInMilliseconds: number): void {
    const existingTimer = this.pendingTimers.get(file.path);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      this.pendingTimers.delete(file.path);
      invokeAsyncSafely(() => this.processFile(file));
    }, delayInMilliseconds);

    this.pendingTimers.set(file.path, timer);
  }
}
