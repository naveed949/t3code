import type { DesktopUpdateState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  getDesktopUpdateProgressView,
  refreshRenderedSidebarUpdateProgressView,
  resolveDisplayedSidebarUpdateProgressView,
  selectSidebarUpdateProgressView,
  type SidebarUpdateProgressView,
} from "./SidebarUpdateProgressPill.logic";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

describe("desktop update sidebar progress", () => {
  it("shows determinate download progress in the shared sidebar pill", () => {
    expect(
      getDesktopUpdateProgressView({
        ...baseState,
        status: "downloading",
        availableVersion: "1.1.0",
        downloadPercent: 42.5,
      }),
    ).toEqual({
      key: "desktop:downloading:1.1.0",
      tone: "loading",
      title: "Downloading T3 Code",
      description: "T3 Code 1.1.0 download is 42% complete.",
      destination: "/settings/general",
      progress: 42.5,
    });
  });

  it("keeps download progress valid when the updater reports an invalid percentage", () => {
    expect(
      getDesktopUpdateProgressView({
        ...baseState,
        status: "downloading",
        downloadPercent: 150,
      }),
    ).toMatchObject({ progress: 100, description: "T3 Code update download is 100% complete." });

    expect(
      getDesktopUpdateProgressView({
        ...baseState,
        status: "downloading",
        downloadPercent: Number.NaN,
      }),
    ).not.toHaveProperty("progress");
  });

  it("does not occupy the progress pill outside an active download", () => {
    expect(
      getDesktopUpdateProgressView({
        ...baseState,
        status: "available",
        availableVersion: "1.1.0",
      }),
    ).toBeNull();
  });

  it("prioritizes a determinate app download over indeterminate provider work", () => {
    const desktopView = getDesktopUpdateProgressView({
      ...baseState,
      status: "downloading",
      downloadPercent: 20,
    });
    const providerView: SidebarUpdateProgressView = {
      key: "provider:loading:codex",
      tone: "loading",
      title: "Updating Codex",
      description: "Codex update in progress.",
      destination: "/settings/providers",
    };

    expect(selectSidebarUpdateProgressView({ desktopView, providerView })).toBe(desktopView);
    expect(selectSidebarUpdateProgressView({ desktopView: null, providerView })).toBe(providerView);
  });

  it("retains the latest progress while the pill exits", () => {
    const renderedView: SidebarUpdateProgressView = {
      key: "desktop:downloading:1.1.0",
      tone: "loading",
      title: "Downloading T3 Code",
      description: "T3 Code 1.1.0 download is 10% complete.",
      destination: "/settings/general",
      progress: 10,
    };
    const currentView = { ...renderedView, progress: 45 };
    const refreshedView = refreshRenderedSidebarUpdateProgressView(renderedView, currentView);

    expect(refreshedView).toBe(currentView);
    expect(resolveDisplayedSidebarUpdateProgressView(refreshedView, null)).toBe(currentView);
    expect(
      resolveDisplayedSidebarUpdateProgressView(renderedView, {
        ...currentView,
        key: "provider:loading:codex",
      }),
    ).toBe(renderedView);
  });
});
