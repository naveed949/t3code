import { Children, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_USAGE_VIEW,
  type UsageView,
} from "@t3tools/client-runtime/state/subscription-allowance";

import { UsageSkeleton, UsageViewTabs } from "./UsagePage";

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
    }) as ReactElement<{ readonly children: ReactNode; readonly role: string }>;
    const buttons = Children.toArray(output.props.children) as ReactElement<{
      readonly children: string;
      readonly "aria-pressed": boolean;
      readonly onClick: () => void;
    }>[];

    expect(output.props.role).toBe("group");
    expect(buttons.map((button) => button.props.children)).toEqual(["Subscription", "Historical"]);
    expect(buttons.map((button) => button.props["aria-pressed"])).toEqual([true, false]);

    buttons[1]!.props.onClick();
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
