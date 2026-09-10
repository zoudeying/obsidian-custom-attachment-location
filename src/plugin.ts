import type { TAbstractFile } from 'obsidian';
import type {
  PluginConflict,
  PluginGateComponent
} from 'obsidian-dev-utils/obsidian/components/plugin-gate-component';
import type { TranslationsMap } from 'obsidian-dev-utils/obsidian/i18n/i18n';

import { OpenDemoVaultCommandHandler } from 'obsidian-dev-utils/obsidian/command-handlers/open-demo-vault-command-handler';
import { PluginConflictSeverity } from 'obsidian-dev-utils/obsidian/components/plugin-gate-component';
import { PluginSettingsTabComponent } from 'obsidian-dev-utils/obsidian/components/plugin-settings-tab-component';
import { PluginSuggestionComponent } from 'obsidian-dev-utils/obsidian/components/plugin-suggestion-component';
import { SettingsMigrationComponent } from 'obsidian-dev-utils/obsidian/components/settings-migration-component';
import { PluginDataHandler } from 'obsidian-dev-utils/obsidian/data-handler';
import { t } from 'obsidian-dev-utils/obsidian/i18n/i18n';
import { PluginBase } from 'obsidian-dev-utils/obsidian/plugin/plugin';
import { PluginEventSourceImpl } from 'obsidian-dev-utils/obsidian/plugin/plugin-event-source';
import { ValueWrapper } from 'obsidian-dev-utils/value-wrapper';

import type { MigratableSettings } from './advanced-rename-and-delete-handler.ts';

import {
  ADVANCED_RENAME_AND_DELETE_HANDLER_API_VERSION_RANGE,
  ADVANCED_RENAME_AND_DELETE_HANDLER_MIGRATION_API_CONTRACT,
  ADVANCED_RENAME_AND_DELETE_HANDLER_PLUGIN_ID,
  ADVANCED_RENAME_AND_DELETE_HANDLER_PLUGIN_NAME
} from './advanced-rename-and-delete-handler.ts';
import { ArrayBufferMap } from './array-buffer-map.ts';
import { AttachmentCollector } from './attachment-collector.ts';
import { AttachmentPathManager } from './attachment-path-manager.ts';
import { AttachmentSaver } from './attachment-saver.ts';
import { CollectAttachmentsEntireVaultCommandHandler } from './command-handlers/collect-attachments-entire-vault-command-handler.ts';
import { CollectAttachmentsInCurrentFolderCommandHandler } from './command-handlers/collect-attachments-in-current-folder-command-handler.ts';
import { CollectAttachmentsInFileCommandHandler } from './command-handlers/collect-attachments-in-file-command-handler.ts';
import { DeleteUnusedAttachmentsEntireVaultCommandHandler } from './command-handlers/delete-unused-attachments-entire-vault-command-handler.ts';
import { DeleteUnusedAttachmentsInFileCommandHandler } from './command-handlers/delete-unused-attachments-in-file-command-handler.ts';
import { GoToAttachmentFolderCommandHandler } from './command-handlers/go-to-attachment-folder-command-handler.ts';
import { GoToOwningNoteCommandHandler } from './command-handlers/go-to-owning-note-command-handler.ts';
import { MoveAttachmentToProperFolderCommandHandler } from './command-handlers/move-attachment-to-proper-folder-command-handler.ts';
import {
  CONSISTENT_ATTACHMENTS_AND_LINKS_COLLECTING_VERSION_RANGE,
  CONSISTENT_ATTACHMENTS_AND_LINKS_PLUGIN_ID,
  CONSISTENT_ATTACHMENTS_AND_LINKS_PLUGIN_NAME
} from './consistent-attachments-and-links.ts';
import { CustomAttachmentLocationComponent } from './custom-attachment-location-component.ts';
import { HandedOverSettingsComponent } from './handed-over-settings-component.ts';
import { translationsMap } from './i18n/locales/translations-map.ts';
import { ImageManager } from './image-manager.ts';
import { ImageSizeMap } from './image-size-map.ts';
import { MarkdownUrlMap } from './markdown-url-map.ts';
import { NetworkImageDownloader } from './network-image-downloader.ts';
import { NoteOwnerResolver } from './note-owner-resolver.ts';
import { AppSaveAttachmentPatchComponent } from './patches/app-save-attachment-patch-component.ts';
import { PluginSettingsComponent } from './plugin-settings-component.ts';
import { PluginSettingsTab } from './plugin-settings-tab.ts';
import { TokenValidator } from './token-validator.ts';
import { TokenizedStringLanguageComponent } from './tokenized-string-language-component.ts';
import { UnusedAttachmentsRemover } from './unused-attachments-remover.ts';

export class Plugin extends PluginBase {
  private attachmentCollector: AttachmentCollector | null = null;

  /**
   * Collects the attachments of the given notes into the folders the settings say they belong in,
   * exactly as the **Collect attachments in current note** command does.
   *
   * This is the plugin's public surface for other plugins. It exists because the command itself acts
   * on the ACTIVE file, so a caller that wants a specific note collected would otherwise have to open
   * it first — a visible side effect of an unrelated operation. Reached as:
   *
   * ```ts
   * const plugin = app.plugins.getPlugin('obsidian-custom-attachment-location');
   * // Check the method is there before calling it: the user may have an older version, or none.
   * plugin?.collectAttachmentsInAbstractFiles?.([noteFile]);
   * ```
   *
   * The work is queued rather than awaited, matching the command, so this returns immediately.
   *
   * @param abstractFiles - The notes, or folders of notes, to collect attachments for.
   */
  public collectAttachmentsInAbstractFiles(abstractFiles: TAbstractFile[]): void {
    this.attachmentCollector?.collectAttachmentsInAbstractFiles(abstractFiles);
  }

  protected override createTranslationsMap(): TranslationsMap {
    return translationsMap;
  }

  protected override getPluginConflicts(): PluginConflict[] {
    return [
      {
        conflictingVersionRange: CONSISTENT_ATTACHMENTS_AND_LINKS_COLLECTING_VERSION_RANGE,
        pluginId: CONSISTENT_ATTACHMENTS_AND_LINKS_PLUGIN_ID,
        pluginName: CONSISTENT_ATTACHMENTS_AND_LINKS_PLUGIN_NAME,
        reason: t(($) => $.pluginConflict.consistentAttachmentsAndLinks.reason),
        severity: PluginConflictSeverity.Warn
      }
    ];
  }

  protected override async onloadImpl(): Promise<void> {
    const validatorWrapper = ValueWrapper.unset<TokenValidator>();

    // Before the settings component, which reads back through it: `isNoteEx` consults the attachment-extension
    // List that Advanced Rename and Delete Handler owns since 12.0.0.
    const handedOverSettingsComponent = this.addChild(
      new HandedOverSettingsComponent({
        app: this.app
      })
    );

    const pluginSettingsComponent = this.addChild(
      new PluginSettingsComponent({
        app: this.app,
        dataHandler: new PluginDataHandler(this),
        handedOverSettingsComponent,
        pluginEventSource: new PluginEventSourceImpl(this),
        validatorWrapper
      })
    );
    this.pluginSettingsComponent = pluginSettingsComponent;

    const pluginSuggestionComponent = this.addChild(
      new PluginSuggestionComponent({
        app: this.app,
        isSuggestionDeclined: (): boolean => pluginSettingsComponent.settings.isAdvancedRenameAndDeleteHandlerSuggestionDeclined,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        reason: t(($) => $.pluginSuggestion.reason),
        // `editAndSave`, not `setProperty`: a decline has to outlive a reload, and `setProperty` only edits
        // The in-memory state, so the suggestion would come back forever.
        setSuggestionDeclined: async (isDeclined): Promise<void> => {
          await pluginSettingsComponent.editAndSave((settings) => {
            settings.isAdvancedRenameAndDeleteHandlerSuggestionDeclined = isDeclined;
          });
        },
        suggestedPluginId: ADVANCED_RENAME_AND_DELETE_HANDLER_PLUGIN_ID,
        suggestedPluginName: ADVANCED_RENAME_AND_DELETE_HANDLER_PLUGIN_NAME
      })
    );

    this.addChild(
      new SettingsMigrationComponent<MigratableSettings>({
        apiVersionRange: ADVANCED_RENAME_AND_DELETE_HANDLER_API_VERSION_RANGE,
        app: this.app,
        // Deliberately NARROWER than the read-back's contract: migrating needs only `migrateSettings`,
        // Which has been published since contract `1.0.0`. Asking for more here would refuse to offer the
        // Migration to a user on an older provider — which is exactly the user who has settings to migrate.
        contract: ADVANCED_RENAME_AND_DELETE_HANDLER_MIGRATION_API_CONTRACT,
        getProposedSettings: (): MigratableSettings | null => pluginSettingsComponent.settings.proposedRenameDeleteSettings,
        pluginSettingsComponent,
        providerPluginId: ADVANCED_RENAME_AND_DELETE_HANDLER_PLUGIN_ID,
        retireProposedSettings: async (): Promise<void> => {
          await pluginSettingsComponent.editAndSave((settings) => {
            settings.proposedRenameDeleteSettings = null;
          });
        },
        sourcePluginId: this.manifest.id
      })
    );

    const validator = new TokenValidator({
      app: this.app,
      pluginSettingsComponent
    });

    validatorWrapper.value = validator;

    const getAvailablePathForAttachmentsOriginal = this.app.vault.getAvailablePathForAttachments.bind(this.app.vault);

    const attachmentPathManager = new AttachmentPathManager({
      app: this.app,
      getAvailablePathForAttachmentsOriginal,
      handedOverSettingsComponent,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent,
      tokenValidator: validator
    });

    const arrayBufferMap = new ArrayBufferMap({
      app: this.app
    });

    const imageSizeMap = new ImageSizeMap();
    const markdownUrlMap = new MarkdownUrlMap();
    const imageManager = new ImageManager({
      pluginSettingsComponent
    });

    const attachmentSaver = new AttachmentSaver({
      app: this.app,
      arrayBufferMap,
      attachmentPathManager,
      handedOverSettingsComponent,
      imageManager,
      imageSizeMap,
      markdownUrlMap,
      pluginSettingsComponent,
      tokenValidator: validator
    });

    this.addChild(
      new CustomAttachmentLocationComponent({
        app: this.app,
        arrayBufferMap,
        attachmentPathManager,
        handedOverSettingsComponent,
        imageSizeMap,
        markdownUrlMap,
        pluginDirectory: this.manifest.dir ?? '',
        pluginId: this.manifest.id,
        pluginSettingsComponent,
        pluginVersion: this.manifest.version,
        tokenValidator: validator
      })
    );

    this.addChild(
      new PluginSettingsTabComponent({
        plugin: this,
        pluginSettingsTab: new PluginSettingsTab({
          // Deliberately lazy: the gate is what loads this method, so the base has not assigned it yet.
          getPluginGateComponent: (): PluginGateComponent => this.pluginGateComponent,
          plugin: this,
          pluginSettingsComponent,
          pluginSuggestionComponent
        })
      })
    );

    const networkImageDownloader = new NetworkImageDownloader({
      abortSignalComponent: this.abortSignalComponent,
      app: this.app,
      attachmentPathManager,
      pluginSettingsComponent
    });

    const attachmentCollector = new AttachmentCollector({
      abortSignalComponent: this.abortSignalComponent,
      app: this.app,
      attachmentPathManager,
      consoleDebugComponent: this.consoleDebugComponent,
      handedOverSettingsComponent,
      networkImageDownloader,
      pluginName: this.manifest.name,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent,
      resourceLockComponent: this.resourceLockComponent
    });
    this.attachmentCollector = attachmentCollector;

    const unusedAttachmentsRemover = new UnusedAttachmentsRemover({
      abortSignalComponent: this.abortSignalComponent,
      app: this.app,
      attachmentPathManager,
      handedOverSettingsComponent,
      pluginName: this.manifest.name,
      pluginNoticeComponent: this.pluginNoticeComponent,
      pluginSettingsComponent
    });

    const noteOwnerResolver = new NoteOwnerResolver({
      app: this.app,
      handedOverSettingsComponent,
      pluginSettingsComponent
    });

    await this.commandHandlerComponent.registerCommandHandlers(() => [
      new CollectAttachmentsInFileCommandHandler({
        attachmentCollector
      }),
      new DeleteUnusedAttachmentsInFileCommandHandler({
        unusedAttachmentsRemover
      }),
      new CollectAttachmentsInCurrentFolderCommandHandler({
        attachmentCollector
      }),
      new CollectAttachmentsEntireVaultCommandHandler({
        attachmentCollector
      }),
      new DeleteUnusedAttachmentsEntireVaultCommandHandler({
        unusedAttachmentsRemover
      }),
      new MoveAttachmentToProperFolderCommandHandler({
        abortSignalComponent: this.abortSignalComponent,
        app: this.app,
        attachmentPathManager,
        handedOverSettingsComponent,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent,
        resourceLockComponent: this.resourceLockComponent
      }),
      new GoToAttachmentFolderCommandHandler({
        app: this.app,
        attachmentPathManager,
        handedOverSettingsComponent,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent
      }),
      new GoToOwningNoteCommandHandler({
        app: this.app,
        noteOwnerResolver,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginSettingsComponent
      }),
      new OpenDemoVaultCommandHandler({
        app: this.app,
        pluginId: this.manifest.id,
        pluginNoticeComponent: this.pluginNoticeComponent,
        pluginVersion: this.manifest.version
      })
    ]);

    this.addChild(
      new AppSaveAttachmentPatchComponent({
        app: this.app,
        attachmentSaver
      })
    );

    this.addChild(new TokenizedStringLanguageComponent());
  }
}
