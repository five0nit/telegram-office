import { useCallback, useEffect, useRef, useState } from 'react';

import { toMajorMinor } from './changelogData.js';
import { BottomToolbar } from './components/BottomToolbar.js';
import { ChangelogModal } from './components/ChangelogModal.js';
import { DebugView } from './components/DebugView.js';
import { EditActionBar } from './components/EditActionBar.js';
import { MigrationNotice } from './components/MigrationNotice.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Tooltip } from './components/Tooltip.js';
import { Modal } from './components/ui/Modal.js';
import { VersionIndicator } from './components/VersionIndicator.js';
import { ZoomControls } from './components/ZoomControls.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { OfficeState } from './office/engine/officeState.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { EditTool, type OfficeLayout, TILE_SIZE, TileType } from './office/types.js';
import { isBrowserRuntime } from './runtime.js';
import { transport } from './transport/index.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

const MOBILE_WIDTH_BREAKPOINT_PX = 640;
const MOBILE_LANDSCAPE_BREAKPOINT_PX = 900;

interface OccupiedBounds {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

function getOccupiedBounds(layout: OfficeLayout): OccupiedBounds | null {
  let minCol = layout.cols;
  let maxCol = -1;
  let minRow = layout.rows;
  let maxRow = -1;

  for (let row = 0; row < layout.rows; row += 1) {
    for (let col = 0; col < layout.cols; col += 1) {
      if (layout.tiles[row * layout.cols + col] !== TileType.VOID) {
        minCol = Math.min(minCol, col);
        maxCol = Math.max(maxCol, col);
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
      }
    }
  }

  if (maxCol < 0 || maxRow < 0) {
    return null;
  }

  return { minCol, maxCol, minRow, maxRow };
}

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

function App() {
  // Browser runtime (dev or static dist): dispatch mock messages after the
  // useExtensionMessages listener has been registered.
  useEffect(() => {
    // browserMock is for Vite dev mode only (UI prototyping without a server).
    // In standalone server mode, the server sends all state over WebSocket.
    // In VS Code mode, the extension sends all state via postMessage.
    if (isBrowserRuntime && import.meta.env.DEV) {
      void import('./browserMock.js').then(({ dispatchMockMessages }) => dispatchMockMessages());
    }
  }, []);

  const editor = useEditorActions(getOfficeState, editorState);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  const {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    workspaceFolders,
    externalAssetDirectories,
    lastSeenVersion,
    extensionVersion,
    watchAllSessions,
    setWatchAllSessions,
    alwaysShowLabels,
    hooksEnabled,
    setHooksEnabled,
    hooksInfoShown,
  } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty);

  // Show migration notice once layout reset is detected
  const [migrationNoticeDismissed, setMigrationNoticeDismissed] = useState(false);
  const showMigrationNotice = layoutWasReset && !migrationNoticeDismissed;

  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHooksInfoOpen, setIsHooksInfoOpen] = useState(false);
  const [hooksTooltipDismissed, setHooksTooltipDismissed] = useState(false);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [alwaysShowOverlay, setAlwaysShowOverlay] = useState(false);
  const demoBubbleTimersRef = useRef<number[]>([]);
  const [demoBubbleTick, setDemoBubbleTick] = useState(0);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }));
  const initialViewportFramedRef = useRef(false);

  const currentMajorMinor = toMajorMinor(extensionVersion);
  const isCompactMobile =
    viewport.width <= MOBILE_WIDTH_BREAKPOINT_PX ||
    (viewport.width <= MOBILE_LANDSCAPE_BREAKPOINT_PX && viewport.height > viewport.width);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleWhatsNewDismiss = useCallback(() => {
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  const handleOpenChangelog = useCallback(() => {
    setIsChangelogOpen(true);
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  // Sync alwaysShowOverlay from persisted settings
  useEffect(() => {
    setAlwaysShowOverlay(alwaysShowLabels);
  }, [alwaysShowLabels]);

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), []);
  const handleToggleAlwaysShowOverlay = useCallback(() => {
    setAlwaysShowOverlay((prev) => {
      const newVal = !prev;
      transport.send({ type: 'setAlwaysShowLabels', enabled: newVal });
      return newVal;
    });
  }, []);

  const handleSelectAgent = useCallback((id: number) => {
    transport.send({ type: 'focusAgent', id });
  }, []);

  const clearDemoBubbleTimers = useCallback(() => {
    for (const timer of demoBubbleTimersRef.current) {
      window.clearTimeout(timer);
    }
    demoBubbleTimersRef.current = [];
  }, []);

  const handleTriggerDemoBubbles = useCallback(() => {
    const os = getOfficeState();
    const characters = os
      .getCharacters()
      .filter((ch) => !ch.isSubagent)
      .sort((a, b) => a.id - b.id);
    if (characters.length === 0) return;

    clearDemoBubbleTimers();

    const demos = [
      {
        tool: 'TelegramReply',
        eventType: 'thinking' as const,
        preview: 'Drafting reply',
      },
      {
        tool: 'Bash',
        eventType: null,
        preview: null,
      },
      {
        tool: 'TelegramRead',
        eventType: 'message_received' as const,
        preview: 'Incoming ping',
      },
      {
        tool: 'TelegramReply',
        eventType: 'message_sent' as const,
        preview: 'Sent update',
      },
      {
        tool: null,
        eventType: 'waiting' as const,
        preview: 'Awaiting approval',
      },
    ] as const;

    for (let index = 0; index < Math.min(demos.length, characters.length); index += 1) {
      const character = characters[index];
      const demo = demos[index];
      os.clearTelegramEvent(character.id);
      os.clearPermissionBubble(character.id);
      os.setAgentTool(character.id, demo.tool);
      if (demo.eventType === 'waiting') {
        os.showWaitingBubble(character.id);
      }
      if (demo.eventType) {
        os.showTelegramEvent(character.id, demo.eventType, demo.preview ?? undefined, 'Demo');
        os.triggerTelegramOfficeReaction(character.id, demo.eventType);
      }
    }

    setDemoBubbleTick((tick) => tick + 1);

    const resetTimer = window.setTimeout(() => {
      for (let index = 0; index < Math.min(demos.length, characters.length); index += 1) {
        const character = characters[index];
        os.setAgentTool(character.id, null);
        os.clearTelegramEvent(character.id);
      }
      setDemoBubbleTick((tick) => tick + 1);
      demoBubbleTimersRef.current = demoBubbleTimersRef.current.filter(
        (timer) => timer !== resetTimer,
      );
    }, 6500);

    demoBubbleTimersRef.current.push(resetTimer);
  }, [clearDemoBubbleTimers]);

  const containerRef = useRef<HTMLDivElement>(null);

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  const handleCloseAgent = useCallback((id: number) => {
    transport.send({ type: 'closeAgent', id });
  }, []);

  const handleClick = useCallback((agentId: number) => {
    // If clicked agent is a sub-agent, focus the parent's terminal instead
    const os = getOfficeState();
    const meta = os.subagentMeta.get(agentId);
    const focusId = meta ? meta.parentAgentId : agentId;
    transport.send({ type: 'focusAgent', id: focusId });
  }, []);

  const officeState = getOfficeState();

  useEffect(() => {
    if (!layoutReady || initialViewportFramedRef.current) return;

    const layout = officeState.getLayout();
    const occupiedBounds = getOccupiedBounds(layout);
    if (!occupiedBounds) return;

    const dpr = window.devicePixelRatio || 1;
    const horizontalPadding = isCompactMobile ? 24 : 220;
    const verticalPadding = isCompactMobile ? 164 : 180;
    const usableWidth = Math.max(240, viewport.width - horizontalPadding) * dpr;
    const usableHeight = Math.max(240, viewport.height - verticalPadding) * dpr;
    const occupiedWidth = (occupiedBounds.maxCol - occupiedBounds.minCol + 1) * TILE_SIZE;
    const occupiedHeight = (occupiedBounds.maxRow - occupiedBounds.minRow + 1) * TILE_SIZE;
    const fitZoom = Math.floor(
      Math.min((usableWidth * 0.96) / occupiedWidth, (usableHeight * 0.9) / occupiedHeight),
    );
    const minZoom = isCompactMobile ? 3 : 4;
    const maxZoom = isCompactMobile ? 6 : 8;
    const nextZoom = Math.max(
      minZoom,
      Math.min(maxZoom, Number.isFinite(fitZoom) && fitZoom > 0 ? fitZoom : editor.zoom),
    );

    if (nextZoom !== editor.zoom) {
      editor.handleZoomChange(nextZoom);
    }

    const centerCol = (occupiedBounds.minCol + occupiedBounds.maxCol + 1) / 2;
    const centerRow = (occupiedBounds.minRow + occupiedBounds.maxRow + 1) / 2;
    const mapWidth = layout.cols * TILE_SIZE * nextZoom;
    const mapHeight = layout.rows * TILE_SIZE * nextZoom;
    const toolbarBias = Math.round(viewport.height * dpr * (isCompactMobile ? 0.07 : 0.03));

    editor.panRef.current = {
      x: mapWidth / 2 - centerCol * TILE_SIZE * nextZoom,
      y: mapHeight / 2 - centerRow * TILE_SIZE * nextZoom - toolbarBias,
    };
    initialViewportFramedRef.current = true;
  }, [editor, isCompactMobile, layoutReady, officeState, viewport.height, viewport.width]);

  useEffect(() => () => clearDemoBubbleTimers(), [clearDemoBubbleTimers]);

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard;
  void demoBubbleTick;

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorState.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorState.selectedFurnitureType)
      ) {
        return true;
      }
      return false;
    })();

  if (!layoutReady) {
    return <div className="w-full h-full flex items-center justify-center ">Loading...</div>;
  }

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
      />

      {!isDebugMode ? (
        <>
          <ZoomControls
            zoom={editor.zoom}
            onZoomChange={editor.handleZoomChange}
            isCompactMobile={isCompactMobile}
          />

          {/* Vignette overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'var(--vignette)' }}
          />

          {editor.isEditMode && editor.isDirty && (
            <EditActionBar editor={editor} editorState={editorState} />
          )}

          {showRotateHint && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-11 bg-accent-bright text-white text-sm py-3 px-8 rounded-none border-2 border-accent shadow-pixel pointer-events-none whitespace-nowrap"
              style={{ top: editor.isDirty ? 64 : 8 }}
            >
              Rotate (R)
            </div>
          )}

          {editor.isEditMode &&
            (() => {
              const selUid = editorState.selectedFurnitureUid;
              const selColor = selUid
                ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
                : null;
              return (
                <EditorToolbar
                  activeTool={editorState.activeTool}
                  selectedTileType={editorState.selectedTileType}
                  selectedFurnitureType={editorState.selectedFurnitureType}
                  selectedFurnitureUid={selUid}
                  selectedFurnitureColor={selColor}
                  floorColor={editorState.floorColor}
                  wallColor={editorState.wallColor}
                  selectedWallSet={editorState.selectedWallSet}
                  onToolChange={editor.handleToolChange}
                  onTileTypeChange={editor.handleTileTypeChange}
                  onFloorColorChange={editor.handleFloorColorChange}
                  onWallColorChange={editor.handleWallColorChange}
                  onWallSetChange={editor.handleWallSetChange}
                  onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                  onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                  loadedAssets={loadedAssets}
                />
              );
            })()}

          <ToolOverlay
            officeState={officeState}
            agents={agents}
            agentTools={agentTools}
            agentStatuses={agentStatuses}
            subagentCharacters={subagentCharacters}
            containerRef={containerRef}
            zoom={editor.zoom}
            panRef={editor.panRef}
            onCloseAgent={handleCloseAgent}
            alwaysShowOverlay={alwaysShowOverlay}
          />

          {isBrowserRuntime && agents.length === 0 && !editor.isEditMode && (
            <div className="absolute top-10 left-1/2 -translate-x-1/2 z-20 max-w-xl pixel-panel px-12 py-10 text-center">
              <div className="text-xs uppercase tracking-wide text-text-muted mb-4">
                Standalone browser office
              </div>
              <div className="text-base text-text mb-4">
                This fork now treats the browser office as the main product surface.
              </div>
              <div className="text-sm text-text-muted leading-relaxed">
                No VS Code hooks or Claude session scanning run on startup. The next step is wiring
                Telegram events into this office so messages, mentions, and commands animate desks,
                workers, and room activity.
              </div>
            </div>
          )}
        </>
      ) : (
        <DebugView
          agents={agents}
          selectedAgent={selectedAgent}
          agentTools={agentTools}
          agentStatuses={agentStatuses}
          subagentTools={subagentTools}
          onSelectAgent={handleSelectAgent}
        />
      )}

      {/* Hooks first-run tooltip */}
      {!isBrowserRuntime && !hooksInfoShown && !hooksTooltipDismissed && (
        <Tooltip
          title="Instant Detection Active"
          position="top-right"
          onDismiss={() => {
            setHooksTooltipDismissed(true);
            transport.send({ type: 'setHooksInfoShown' });
          }}
        >
          <span className="text-sm text-text leading-none">
            Your agents now respond in real-time.{' '}
            <span
              className="text-accent cursor-pointer underline"
              onClick={() => {
                setIsHooksInfoOpen(true);
                setHooksTooltipDismissed(true);
                transport.send({ type: 'setHooksInfoShown' });
              }}
            >
              View more
            </span>
          </span>
        </Tooltip>
      )}

      {/* Hooks info modal */}
      {!isBrowserRuntime && (
        <Modal
          isOpen={isHooksInfoOpen}
          onClose={() => setIsHooksInfoOpen(false)}
          title="Instant Detection is ON"
          zIndex={52}
        >
          <div className="text-base text-text px-10" style={{ lineHeight: 1.4 }}>
            <p className="mb-8">Your Pixel Agents office now reacts in real-time:</p>
            <ul className="mb-8 pl-18 list-disc m-0">
              <li className="text-sm mb-2">Permission prompts appear instantly</li>
              <li className="text-sm mb-2">Turn completions detected the moment they happen</li>
              <li className="text-sm mb-2">Sound notifications play immediately</li>
            </ul>
            <p className="mb-12 text-text-muted">
              This works through Claude Code Hooks, small event listeners that notify Pixel Agents
              whenever something happens in your Claude sessions.
            </p>
            <div className="text-center">
              <button
                onClick={() => setIsHooksInfoOpen(false)}
                className="py-4 px-20 text-lg bg-accent text-white border-2 border-accent rounded-none cursor-pointer shadow-pixel"
              >
                Got it
              </button>
            </div>
            <p className="mt-8 text-xs text-text-muted text-center">
              To disable, go to Settings {'>'} Instant Detection
            </p>
          </div>
        </Modal>
      )}

      <BottomToolbar
        isEditMode={editor.isEditMode}
        onOpenClaude={editor.handleOpenClaude}
        onToggleEditMode={editor.handleToggleEditMode}
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={() => setIsSettingsOpen((v) => !v)}
        workspaceFolders={workspaceFolders}
        isCompactMobile={isCompactMobile}
      />

      <VersionIndicator
        currentVersion={extensionVersion}
        lastSeenVersion={lastSeenVersion}
        onDismiss={handleWhatsNewDismiss}
        onOpenChangelog={handleOpenChangelog}
        isCompactMobile={isCompactMobile}
      />

      <ChangelogModal
        isOpen={isChangelogOpen}
        onClose={() => setIsChangelogOpen(false)}
        currentVersion={extensionVersion}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        isDebugMode={isDebugMode}
        onToggleDebugMode={handleToggleDebugMode}
        alwaysShowOverlay={alwaysShowOverlay}
        onToggleAlwaysShowOverlay={handleToggleAlwaysShowOverlay}
        externalAssetDirectories={externalAssetDirectories}
        watchAllSessions={watchAllSessions}
        onToggleWatchAllSessions={() => {
          const newVal = !watchAllSessions;
          setWatchAllSessions(newVal);
          transport.send({ type: 'setWatchAllSessions', enabled: newVal });
        }}
        hooksEnabled={hooksEnabled}
        onToggleHooksEnabled={() => {
          const newVal = !hooksEnabled;
          setHooksEnabled(newVal);
          transport.send({ type: 'setHooksEnabled', enabled: newVal });
        }}
        onTriggerDemoBubbles={handleTriggerDemoBubbles}
      />

      {showMigrationNotice && (
        <MigrationNotice onDismiss={() => setMigrationNoticeDismissed(true)} />
      )}
    </div>
  );
}

export default App;
