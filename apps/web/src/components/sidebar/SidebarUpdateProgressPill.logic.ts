import type { DesktopUpdateState } from "@t3tools/contracts";

export type SidebarUpdateProgressTone = "loading" | "warning" | "error" | "success";

export interface SidebarUpdateProgressView {
  readonly key: string;
  readonly tone: SidebarUpdateProgressTone;
  readonly title: string;
  readonly description: string;
  readonly destination: "/settings/general" | "/settings/providers";
  readonly progress?: number;
  readonly dismissible?: boolean;
  readonly dismissAfterVisibleMs?: number;
}

function normalizeProgress(progress: number | null): number | undefined {
  if (progress === null || !Number.isFinite(progress)) return undefined;
  return Math.min(100, Math.max(0, progress));
}

export function getDesktopUpdateProgressView(
  state: DesktopUpdateState | null,
): SidebarUpdateProgressView | null {
  if (state?.status !== "downloading") return null;

  const progress = normalizeProgress(state.downloadPercent);
  const version = state.availableVersion;
  const subject = version ? `T3 Code ${version}` : "T3 Code update";
  const description =
    progress === undefined
      ? `${subject} download is in progress.`
      : `${subject} download is ${Math.floor(progress)}% complete.`;

  return {
    key: `desktop:downloading:${version ?? "unknown"}`,
    tone: "loading",
    title: "Downloading T3 Code",
    description,
    destination: "/settings/general",
    ...(progress === undefined ? {} : { progress }),
  };
}

export function selectSidebarUpdateProgressView({
  desktopView,
  providerView,
}: {
  readonly desktopView: SidebarUpdateProgressView | null;
  readonly providerView: SidebarUpdateProgressView | null;
}): SidebarUpdateProgressView | null {
  return desktopView ?? providerView;
}

export function resolveDisplayedSidebarUpdateProgressView(
  renderedView: SidebarUpdateProgressView | null,
  currentView: SidebarUpdateProgressView | null,
): SidebarUpdateProgressView | null {
  if (renderedView?.key === currentView?.key) return currentView;
  return renderedView ?? currentView;
}
