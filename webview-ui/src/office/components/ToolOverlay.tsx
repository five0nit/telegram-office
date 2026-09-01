import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button.js';
import {
  CHARACTER_SITTING_OFFSET_PX,
  FUEL_COLOR_CRITICAL,
  FUEL_COLOR_DANGER,
  FUEL_COLOR_OK,
  FUEL_COLOR_WARN,
  FUEL_GAUGE_BG,
  FUEL_GAUGE_HEIGHT_PX,
  FUEL_GAUGE_WIDTH_PX,
  MAX_CONTEXT_TOKENS,
  TEAM_LEAD_COLOR,
  TEAM_ROLE_COLOR,
  TOKEN_CRITICAL_THRESHOLD,
  TOKEN_DANGER_THRESHOLD,
  TOKEN_WARN_THRESHOLD,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import type { ToolActivity } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
}

function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  agentStatuses: Record<number, string>,
  isActive: boolean,
): string {
  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    if (isActive) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }

  const status = agentStatuses[agentId];
  if (status && status !== 'active') {
    return status;
  }

  return 'Idle';
}

function getFuelColor(ratio: number): string {
  if (ratio >= TOKEN_CRITICAL_THRESHOLD) return FUEL_COLOR_CRITICAL;
  if (ratio >= TOKEN_DANGER_THRESHOLD) return FUEL_COLOR_DANGER;
  if (ratio >= TOKEN_WARN_THRESHOLD) return FUEL_COLOR_WARN;
  return FUEL_COLOR_OK;
}

function getDisplayName(
  id: number,
  isSub: boolean,
  officeState: OfficeState,
  subagentCharacters: SubagentCharacter[],
): string {
  const ch = officeState.characters.get(id);
  if (!ch) return 'Agent';
  if (isSub) {
    return subagentCharacters.find((s) => s.id === id)?.label || 'Subtask';
  }
  return ch.agentName || ch.folderName || ch.teamName || 'Agent';
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  agentStatuses,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  alwaysShowOverlay,
}: ToolOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;
        const isSub = ch.isSubagent;
        const hasTelegramEvent = (ch.telegramEventTimer ?? 0) > 0;
        const shouldShow = alwaysShowOverlay || isSelected || isHovered || hasTelegramEvent;
        if (!shouldShow) return null;

        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY =
          (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr;

        const subHasPermission = isSub && ch.bubbleType === 'permission';
        const activityText = isSub
          ? subHasPermission
            ? 'Needs approval'
            : getDisplayName(id, true, officeState, subagentCharacters)
          : getActivityText(id, agentTools, agentStatuses, ch.isActive);

        const tools = agentTools[id];
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done);
        const hasActiveTools = tools?.some((t) => !t.done);
        const isActive = ch.isActive;

        let dotColor: string | null = null;
        if (hasPermission) {
          dotColor = 'var(--color-status-permission)';
        } else if (ch.telegramEventType === 'message_received') {
          dotColor = 'var(--color-status-active)';
        } else if (ch.telegramEventType === 'message_sent') {
          dotColor = 'var(--color-accent)';
        } else if (ch.telegramEventType === 'thinking') {
          dotColor = 'var(--color-warning)';
        } else if (ch.telegramEventType === 'waiting') {
          dotColor = 'var(--color-status-permission)';
        } else if (isActive && hasActiveTools) {
          dotColor = 'var(--color-status-active)';
        }

        const title = getDisplayName(id, isSub, officeState, subagentCharacters);
        const showExpandedCard = isSelected || isHovered || alwaysShowOverlay;
        const showCompactBadge = hasTelegramEvent && !showExpandedCard;
        const subtitle =
          isSelected || isHovered
            ? ch.telegramChatLabel ||
              (activityText !== 'Idle' && activityText !== title ? activityText : null)
            : alwaysShowOverlay && ch.teamName && ch.teamName !== title
              ? ch.teamName
              : null;

        if (showCompactBadge) {
          return (
            <div
              key={id}
              className="absolute -translate-x-1/2 -translate-y-1/2 pixel-panel flex items-center justify-center"
              style={{
                left: screenX,
                top: screenY - 8,
                width: 16,
                height: 16,
                zIndex: 41,
                pointerEvents: 'none',
                padding: 0,
              }}
            >
              <span
                className={isActive && !hasPermission ? 'pixel-pulse' : ''}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '999px',
                  background: dotColor ?? 'var(--color-text-muted)',
                  display: 'block',
                }}
              />
            </div>
          );
        }

        const isTeamAgent = !!ch.teamName;
        const totalTokens = ch.inputTokens + ch.outputTokens;
        const tokenRatio = totalTokens / MAX_CONTEXT_TOKENS;

        return (
          <div
            key={id}
            className="absolute flex flex-col items-center -translate-x-1/2"
            style={{
              left: screenX,
              top: screenY - (subtitle ? 36 : 28),
              pointerEvents: isSelected ? 'auto' : 'none',
              opacity: alwaysShowOverlay && !isSelected && !isHovered ? (isSub ? 0.5 : 0.8) : 1,
              zIndex: isSelected ? 42 : 41,
            }}
          >
            <div
              className="flex items-center border-border px-8 pt-3 pb-4 gap-5 pixel-panel whitespace-nowrap"
              style={{ maxWidth: 220 }}
            >
              {dotColor && (
                <span
                  className={`w-6 h-6 rounded-full shrink-0 ${isActive && !hasPermission ? 'pixel-pulse' : ''}`}
                  style={{ background: dotColor }}
                />
              )}
              <div className="flex flex-col gap-0 overflow-hidden min-w-0">
                <span
                  className="overflow-hidden text-ellipsis block leading-none"
                  style={{
                    fontSize: isSub ? '18px' : '20px',
                    color: ch.isTeamLead ? TEAM_LEAD_COLOR : TEAM_ROLE_COLOR,
                    fontWeight: ch.isTeamLead ? 'bold' : undefined,
                    fontStyle: isSub ? 'italic' : undefined,
                  }}
                >
                  {title}
                </span>
                {subtitle && (
                  <span
                    className="overflow-hidden text-ellipsis block leading-tight"
                    style={{
                      fontSize: '14px',
                      color: 'var(--color-text-muted)',
                      marginTop: 2,
                    }}
                  >
                    {subtitle}
                  </span>
                )}
              </div>
              {isSelected && !isSub && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseAgent(id);
                  }}
                  title="Close agent"
                  className="ml-2 shrink-0 leading-none"
                >
                  ×
                </Button>
              )}
            </div>
            {isTeamAgent && totalTokens > 0 && (isSelected || isHovered) && (
              <div
                style={{
                  width: FUEL_GAUGE_WIDTH_PX,
                  height: FUEL_GAUGE_HEIGHT_PX,
                  background: FUEL_GAUGE_BG,
                  marginTop: 2,
                }}
                title={`${Math.round(tokenRatio * 100)}% context used (${(totalTokens / 1000).toFixed(0)}k tokens)`}
              >
                <div
                  style={{
                    width: `${Math.min(tokenRatio * 100, 100)}%`,
                    height: '100%',
                    background: getFuelColor(tokenRatio),
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
