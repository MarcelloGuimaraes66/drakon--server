import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { resolveConversationMemory } from "../conversationMemory";
import type { OperationalPlannerContext } from "../../operationalQuery/schema";

type CarryForwardFixture = {
  language: string;
  query: string;
  expectedCarryForward: boolean;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(
  currentDir,
  "..",
  "fixtures",
  "multilingual",
  "carryForwardCases.json"
);
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as CarryForwardFixture[];

function makeContext(query: string): OperationalPlannerContext {
  return {
    report_id: "r-multi",
    requested_query: query,
    reply_language: "en",
    scope: {
      start_at: "2026-04-13T03:00:00.000Z",
      end_at: "2026-04-14T02:59:59.999Z",
      time_window_hours: 24,
      label: "today",
      focus: [],
    },
    resolved_entities: {
      cameras: [],
      jobs: [],
      steps: [],
      agents: [],
      is_specific: false,
    },
    chat_discussion: {
      task_state: {
        session_entities: {},
      },
      recent_turns: [],
    },
  };
}

for (const fixture of fixtures) {
  test(`carry-forward fixture ${fixture.language}`, () => {
    const memory = resolveConversationMemory(makeContext(fixture.query), fixture.query);
    assert.equal(memory.carry_forward_requested, fixture.expectedCarryForward);
  });
}
