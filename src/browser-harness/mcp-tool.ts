/**
 * MCP Tool definition for browser_harness.
 * Exposes all 13 daemon actions as a single tool with action routing.
 */

import { BrowserHarnessBridge, BridgeError } from "./bridge.js";

export const BROWSER_HARNESS_TOOL = {
  name: "browser_harness",
  description:
    "Persistent browser automation via CDP. Supports navigation, interaction, screenshots, " +
    "and skill accumulation (the daemon learns successful patterns over time). " +
    "Use for web scraping, form filling, testing, and any browser automation that benefits from persistence.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: [
          "navigate",
          "evaluate",
          "click",
          "fill",
          "screenshot",
          "wait_for",
          "get_html",
          "get_text",
          "get_url",
          "get_title",
          "skill_record",
          "skill_find",
          "skill_execute",
        ],
        description: "The browser action to perform",
      },
      url: {
        type: "string",
        description: "URL to navigate to (for 'navigate' action)",
      },
      expression: {
        type: "string",
        description: "JavaScript expression to evaluate (for 'evaluate' action)",
      },
      selector: {
        type: "string",
        description: "CSS selector for element targeting (for click, fill, wait_for, get_html, get_text)",
      },
      value: {
        type: "string",
        description: "Value to fill into an input (for 'fill' action)",
      },
      full_page: {
        type: "boolean",
        description: "Capture full page screenshot (for 'screenshot' action)",
        default: false,
      },
      timeout: {
        type: "number",
        description: "Timeout in seconds (for 'wait_for' action)",
      },
      // Skill-specific params
      domain: {
        type: "string",
        description: "Domain/site for skill (for skill_* actions)",
      },
      name: {
        type: "string",
        description: "Skill name identifier (for skill_* actions)",
      },
      skill_action: {
        type: "string",
        description: "The action type the skill performs (for 'skill_record')",
      },
      params: {
        type: "object",
        description: "Additional parameters for the skill (for 'skill_record')",
      },
      success: {
        type: "boolean",
        description: "Whether the skill attempt was successful (for 'skill_record')",
        default: true,
      },
    },
    required: ["action"],
  },
};

/**
 * Handle a browser_harness tool call.
 */
export async function handleBrowserHarness(
  input: Record<string, unknown>,
  bridge: BrowserHarnessBridge
): Promise<string> {
  const action = input.action as string;

  try {
    if (!bridge.isConnected()) {
      return JSON.stringify({
        error: "Browser harness daemon is not connected. Is the service running?",
        hint: "Check: systemctl status browser-harness",
      });
    }

    let result: unknown;

    switch (action) {
      case "navigate":
        result = await bridge.navigate(input.url as string);
        break;
      case "evaluate":
        result = await bridge.evaluate(input.expression as string);
        break;
      case "click":
        result = await bridge.click(input.selector as string);
        break;
      case "fill":
        result = await bridge.fill(input.selector as string, input.value as string);
        break;
      case "screenshot":
        result = await bridge.screenshot(input.full_page as boolean);
        break;
      case "wait_for":
        result = await bridge.waitFor(input.selector as string, input.timeout as number);
        break;
      case "get_html":
        result = await bridge.getHtml(input.selector as string || "body");
        break;
      case "get_text":
        result = await bridge.getText(input.selector as string || "body");
        break;
      case "get_url":
        result = await bridge.getUrl();
        break;
      case "get_title":
        result = await bridge.getTitle();
        break;
      case "skill_record":
        result = await bridge.skillRecord(
          input.domain as string,
          input.name as string,
          input.skill_action as string,
          {
            selector: input.selector as string | undefined,
            params: input.params as Record<string, unknown> | undefined,
            success: input.success as boolean | undefined,
          }
        );
        break;
      case "skill_find":
        result = await bridge.skillFind(input.domain as string, input.name as string | undefined);
        break;
      case "skill_execute":
        result = await bridge.skillExecute(input.domain as string, input.name as string);
        break;
      default:
        return JSON.stringify({ error: `Unknown action: ${action}` });
    }

    return JSON.stringify(result, null, 2);
  } catch (err) {
    if (err instanceof BridgeError) {
      return JSON.stringify({ error: err.message, code: err.code });
    }
    return JSON.stringify({ error: String(err) });
  }
}
