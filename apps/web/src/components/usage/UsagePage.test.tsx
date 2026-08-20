import { Children, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_USAGE_VIEW,
  type UsageView,
} from "@t3tools/client-runtime/state/subscription-allowance";

import { UsageSkeleton, UsageViewTabs } from "./UsagePage";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

describe("UsagePage defaults", () => {
  it("opens on the Subscription view", () => {
    expect(DEFAULT_USAGE_VIEW).toBe("subscription");
  });
});

describe("UsageViewTabs", () => {
  it("exposes an accessible Subscription/Historical segmented control", () => {
    const selected: UsageView[] = [];
    const output = UsageViewTabs({
      value: "subscription",
      onChange: (view) => selected.push(view),
    }) as ReactElement<{
      readonly children: ReactNode;
      readonly onValueChange: (value: readonly string[]) => void;
      readonly value: readonly string[];
      readonly variant: string;
    }>;
    const toggles = Children.toArray(output.props.children) as ReactElement<{
      readonly children: string;
      readonly value: string;
    }>[];

    expect(output.type).toBe(ToggleGroup);
    expect(output.props.variant).toBe("segmented");
    expect(output.props.value).toEqual(["subscription"]);
    expect(toggles.map((toggle) => toggle.type)).toEqual([Toggle, Toggle]);
    expect(toggles.map((toggle) => toggle.props.children)).toEqual(["Subscription", "Historical"]);
    expect(toggles.map((toggle) => toggle.props.value)).toEqual(["subscription", "historical"]);

    output.props.onValueChange(["historical"]);
    expect(selected).toEqual(["historical"]);
  });
});

describe("UsageSkeleton", () => {
  it("matches the chart resolution while historical usage is loading", () => {
    const hourlyMarkup = renderToStaticMarkup(<UsageSkeleton resolution="hour" />);
    const dailyMarkup = renderToStaticMarkup(<UsageSkeleton resolution="day" />);

    expect(hourlyMarkup).toContain("Hourly cost");
    expect(dailyMarkup).toContain("Daily cost");
  });
});
