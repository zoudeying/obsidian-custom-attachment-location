// @vitest-environment jsdom

import type {
  App,
  EventRef,
  TAbstractFile,
  TFile
} from 'obsidian';

import { isFile } from '@mnaoumov/obsidian-lib/file-system';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { Plugin } from '../plugin.ts';
import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import { PluginSettings } from '../settings/plugin-settings.ts';
import { AutomaticBase64ExtractorComponent } from './automatic-base64-extractor-component.ts';
import { extractBase64ImagesInFile } from './base64-extractor.ts';

vi.mock('@mnaoumov/obsidian-lib/file-system', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mnaoumov/obsidian-lib/file-system')>(),
  isFile: vi.fn()
}));

vi.mock('./base64-extractor.ts', () => ({
  extractBase64ImagesInFile: vi.fn()
}));

const mockIsFile = vi.mocked(isFile);
const mockExtractBase64ImagesInFile = vi.mocked(extractBase64ImagesInFile);

interface LayoutReadyTrigger {
  readonly onLayoutReady: () => void;
}

describe('AutomaticBase64ExtractorComponent', () => {
  const NOTE = strictProxy<TFile>({
    basename: 'note',
    path: 'note.md'
  });

  let createdHandler: ((file: TAbstractFile) => void) | null;
  let changedHandler: ((file: TFile) => void) | null;
  let isNoteEx: ReturnType<typeof vi.fn<PluginSettingsComponent['isNoteEx']>>;
  let isPathIgnored: ReturnType<typeof vi.fn>;
  let settings: PluginSettings;
  let vaultReadMock: ReturnType<typeof vi.fn>;
  let component: AutomaticBase64ExtractorComponent | undefined;

  function startListening(): void {
    component = new AutomaticBase64ExtractorComponent({
      app: strictProxy<App>({
        metadataCache: strictProxy<App['metadataCache']>({
          on: castTo<App['metadataCache']['on']>((name: string, callback: (file: TFile) => void): EventRef => {
            expect(name).toBe('changed');
            changedHandler = callback;
            return castTo<EventRef>({});
          })
        }),
        vault: strictProxy<App['vault']>({
          on: castTo<App['vault']['on']>((name: string, callback: (file: TAbstractFile) => void): EventRef => {
            expect(name).toBe('create');
            createdHandler = callback;
            return castTo<EventRef>({});
          }),
          read: castTo<App['vault']['read']>(vaultReadMock)
        })
      }),
      plugin: strictProxy<Plugin>({
        abortSignal: new AbortController().signal,
        handedOverSettingsComponent: strictProxy<Plugin['handedOverSettingsComponent']>({
          isPathIgnored: castTo<Plugin['handedOverSettingsComponent']['isPathIgnored']>(isPathIgnored)
        })
      }),
      pluginSettingsComponent: strictProxy<PluginSettingsComponent>({
        isNoteEx,
        settings
      })
    });
    castTo<LayoutReadyTrigger>(component).onLayoutReady();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    createdHandler = null;
    changedHandler = null;
    mockIsFile.mockReturnValue(true);
    isNoteEx = vi.fn<PluginSettingsComponent['isNoteEx']>().mockReturnValue(true);
    isPathIgnored = vi.fn().mockReturnValue(false);
    settings = new PluginSettings();
    settings.shouldExtractBase64ImagesAutomatically = true;
    vaultReadMock = vi.fn().mockResolvedValue('# Test Note\nSome text here');
    mockExtractBase64ImagesInFile.mockResolvedValue(1);
  });

  afterEach(() => {
    component?.onunload();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.empty();
  });

  it('should do nothing when the setting is off', async () => {
    settings.shouldExtractBase64ImagesAutomatically = false;
    startListening();

    createdHandler?.(NOTE);
    changedHandler?.(NOTE);
    await vi.runAllTimersAsync();

    expect(mockExtractBase64ImagesInFile).not.toHaveBeenCalled();
  });

  it('should trigger extraction on created note with base64 images', async () => {
    vaultReadMock.mockResolvedValue('# Note\n![img](data:image/png;base64,iVBORw0KGgo= "test.png")');
    startListening();

    createdHandler?.(NOTE);
    await vi.runAllTimersAsync();

    expect(mockExtractBase64ImagesInFile).toHaveBeenCalledWith(
      expect.anything(),
      NOTE,
      expect.objectContaining({ shouldShowNotice: true })
    );
  });

  it('should quickly exit on changed note without base64 images', async () => {
    vaultReadMock.mockResolvedValue('# Normal Note\nJust regular text and [[link]]');
    startListening();

    changedHandler?.(NOTE);
    await vi.runAllTimersAsync();

    expect(vaultReadMock).toHaveBeenCalledWith(NOTE);
    expect(mockExtractBase64ImagesInFile).not.toHaveBeenCalled();
  });

  it('should extract base64 images on changed note when base64 is present', async () => {
    vaultReadMock.mockResolvedValue('# Note\n| <img src="data:image/png;base64,iVBORw0KGgo=" alt="table.png"> |');
    startListening();

    changedHandler?.(NOTE);
    await vi.runAllTimersAsync();

    expect(mockExtractBase64ImagesInFile).toHaveBeenCalledWith(
      expect.anything(),
      NOTE,
      expect.objectContaining({ shouldShowNotice: true })
    );
  });

  it('should skip extraction while link suggestion container is shown', async () => {
    vaultReadMock.mockResolvedValue('# Note\n![img](data:image/png;base64,iVBORw0KGgo=)');
    const suggestionEl = document.body.createDiv({ cls: 'suggestion-container' });
    suggestionEl.isShown = (): boolean => true;

    startListening();
    changedHandler?.(NOTE);
    await vi.runAllTimersAsync();

    expect(mockExtractBase64ImagesInFile).not.toHaveBeenCalled();
  });
});
