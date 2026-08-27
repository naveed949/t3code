import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@t3tools/contracts";
import { CircleCheckIcon, DownloadIcon, LoaderIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { primaryServerProvidersAtom } from "../../state/server";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { getProviderUpdateSidebarPillView } from "../ProviderUpdateLaunchNotification.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Button } from "../ui/button";
import {
  getDesktopUpdateProgressView,
  refreshRenderedSidebarUpdateProgressView,
  resolveDisplayedSidebarUpdateProgressView,
  selectSidebarUpdateProgressView,
  type SidebarUpdateProgressView,
} from "./SidebarUpdateProgressPill.logic";

const UPDATE_PROGRESS_PILL_STYLES = {
  loading:
    "bg-update-surface text-update-foreground group-has-[button.update-progress-main:hover]/update-progress:bg-update/22",
  success:
    "bg-success/12 text-success group-has-[button.update-progress-main:hover]/update-progress:bg-success/18",
  warning:
    "bg-warning/12 text-warning group-has-[button.update-progress-main:hover]/update-progress:bg-warning/18",
  error:
    "bg-destructive/12 text-destructive group-has-[button.update-progress-main:hover]/update-progress:bg-destructive/18",
} as const;

const UPDATE_PROGRESS_PILL_COUNTDOWN_STYLES = {
  success: "bg-success/18",
  warning: "bg-warning/14",
  error: "bg-destructive/14",
} as const;

function latestProviderCheckedAt(
  providers: ReadonlyArray<Pick<ServerProvider, "checkedAt">>,
): string | undefined {
  return providers.reduce<string | undefined>(
    (latest, provider) =>
      latest === undefined || provider.checkedAt > latest ? provider.checkedAt : latest,
    undefined,
  );
}

export function SidebarUpdateProgressPill() {
  const navigate = useNavigate();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const desktopUpdateState = useDesktopUpdateState();
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [renderedView, setRenderedView] = useState<SidebarUpdateProgressView | null>(null);
  const [pendingView, setPendingView] = useState<SidebarUpdateProgressView | null>(null);
  const [exitingKey, setExitingKey] = useState<string | null>(null);
  const [dismissAfterExitKey, setDismissAfterExitKey] = useState<string | null>(null);
  const [visibleAfterIso, setVisibleAfterIso] = useState<string | undefined>();
  const effectiveVisibleAfterIso = visibleAfterIso ?? latestProviderCheckedAt(providers);
  const providerView = getProviderUpdateSidebarPillView(providers, {
    ...(effectiveVisibleAfterIso !== undefined
      ? { visibleAfterIso: effectiveVisibleAfterIso }
      : {}),
    dismissedKeys,
  });
  const view = selectSidebarUpdateProgressView({
    desktopView: getDesktopUpdateProgressView(desktopUpdateState),
    providerView: providerView ? { ...providerView, destination: "/settings/providers" } : null,
  });

  useEffect(() => {
    if (visibleAfterIso === undefined && effectiveVisibleAfterIso !== undefined) {
      setVisibleAfterIso(effectiveVisibleAfterIso);
    }
  }, [effectiveVisibleAfterIso, visibleAfterIso]);

  const displayedView = resolveDisplayedSidebarUpdateProgressView(renderedView, view);
  const dismissAfterVisibleMs = displayedView?.dismissAfterVisibleMs;
  const viewKey = displayedView?.key ?? null;
  const showDismissProgress =
    dismissAfterVisibleMs !== undefined &&
    displayedView?.tone !== "loading" &&
    exitingKey !== viewKey;
  const openUpdateSettings = useCallback(() => {
    if (!displayedView) return;
    void navigate({ to: displayedView.destination });
  }, [displayedView, navigate]);

  const startExit = useCallback(
    (key: string, nextView: SidebarUpdateProgressView | null, dismissKey?: string) => {
      if (exitingKey === key) {
        return;
      }
      setPendingView(nextView);
      setExitingKey(key);
      setDismissAfterExitKey(dismissKey ?? null);
    },
    [exitingKey],
  );

  useEffect(() => {
    if (exitingKey !== null) {
      return;
    }
    if (!renderedView) {
      if (view) {
        setRenderedView(view);
      }
      return;
    }
    const refreshedView = refreshRenderedSidebarUpdateProgressView(renderedView, view);
    if (refreshedView !== renderedView) {
      setRenderedView(refreshedView);
      return;
    }
    if (!view) {
      startExit(renderedView.key, null);
      return;
    }
    if (view.key !== renderedView.key) {
      startExit(renderedView.key, view);
      return;
    }
  }, [exitingKey, renderedView, startExit, view]);

  useEffect(() => {
    if (!dismissAfterVisibleMs || !viewKey) {
      return;
    }
    if (exitingKey === viewKey) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      startExit(viewKey, null, viewKey);
    }, dismissAfterVisibleMs);

    return () => window.clearTimeout(timeoutId);
  }, [dismissAfterVisibleMs, exitingKey, startExit, viewKey]);

  if (!displayedView) {
    return null;
  }

  return (
    <div
      className={`group/update-progress relative flex h-7 w-full items-center overflow-hidden rounded-lg text-xs font-medium transform-gpu transition-all duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
        UPDATE_PROGRESS_PILL_STYLES[displayedView.tone]
      } ${
        exitingKey === displayedView.key
          ? "pointer-events-none translate-y-1.5 opacity-0"
          : "translate-y-0 opacity-100"
      }`}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        if (!displayedView || exitingKey !== displayedView.key) {
          return;
        }
        if (dismissAfterExitKey === displayedView.key) {
          setDismissedKeys((previous) => new Set(previous).add(displayedView.key));
        }
        setRenderedView(pendingView);
        setPendingView(null);
        setExitingKey(null);
        setDismissAfterExitKey(null);
      }}
    >
      {displayedView.progress !== undefined ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 bg-update/18 transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${displayedView.progress}%` }}
        />
      ) : null}
      {showDismissProgress ? (
        <div
          key={displayedView.key}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 w-full origin-left animate-[update-progress-pill-countdown_var(--update-progress-pill-dismiss-ms)_linear_forwards] border-r border-current/15 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)] ${
            UPDATE_PROGRESS_PILL_COUNTDOWN_STYLES[displayedView.tone]
          }`}
          style={
            {
              "--update-progress-pill-dismiss-ms": `${dismissAfterVisibleMs}ms`,
            } as CSSProperties
          }
        />
      ) : null}
      <div className="pointer-events-none absolute inset-0 rounded-lg transition-colors" />
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={displayedView.description}
              className="update-progress-main relative z-[1] flex h-full flex-1 items-center gap-2 px-2 text-left"
              onClick={openUpdateSettings}
            >
              {displayedView.tone === "loading" ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : displayedView.tone === "success" ? (
                <CircleCheckIcon className="size-3.5" />
              ) : displayedView.tone === "error" ? (
                <TriangleAlertIcon className="size-3.5" />
              ) : (
                <DownloadIcon className="size-3.5" />
              )}
              <span className="min-w-0 flex-1 truncate">{displayedView.title}</span>
              {displayedView.progress !== undefined ? (
                <span className="tabular-nums">{Math.floor(displayedView.progress)}%</span>
              ) : null}
            </button>
          }
        />
        <TooltipPopup side="top">{displayedView.description}</TooltipPopup>
      </Tooltip>
      {displayedView.dismissible && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-micro"
                variant="ghost"
                aria-label="Dismiss update notice"
                className="relative z-[1] mr-1 [--control-icon-color:currentColor] rounded-md text-inherit opacity-70 hover:bg-transparent hover:opacity-100"
                onClick={() => startExit(displayedView.key, null, displayedView.key)}
              >
                <XIcon className="size-3.5" />
              </Button>
            }
          />
          <TooltipPopup side="top">Dismiss until update status changes</TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
}
