// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AgentAside } from "../../app/login/agent-aside.js";

afterEach(() => cleanup());

describe("login agent aside", () => {
  it("explains that agents hold keys", () => {
    render(createElement(AgentAside));
    expect(screen.getByText(/Agents don't log in\. They hold keys\./)).toBeTruthy();
  });

  it("labels the aside for agents and developers", () => {
    render(createElement(AgentAside));
    expect(screen.getByText("For agents & developers")).toBeTruthy();
  });
});
