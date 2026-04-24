import test from "node:test";
import assert from "node:assert/strict";

import { buildChatRevealPlan } from "../react-app/utils/chatRevealPlan";

function assertStrictlyIncreasing(values: number[]) {
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(
      values[index] > values[index - 1],
      `expected ${values[index]} to be greater than ${values[index - 1]} at index ${index}`,
    );
  }
}

test("buildChatRevealPlan preserves markdown and yields a paced timeline", () => {
  const markdown =
    "We can help analyze cameras, create jobs, and explain the app.\n\nAsk a follow-up question after this paragraph.";
  const plan = buildChatRevealPlan(markdown);

  assert.equal(plan.chunks.join(""), markdown);
  assert.equal(plan.revealAtMs.length, plan.chunks.length);
  assert.ok(plan.revealAtMs[0] > 0);
  assertStrictlyIncreasing(plan.revealAtMs);
  assert.ok(plan.totalDurationMs > plan.revealAtMs.at(-1)!);
  assert.ok(plan.totalDurationMs >= 1800);
});

test("buildChatRevealPlan reveals list items as separate semantic steps", () => {
  const markdown = "- First item\n- Second item\n- Third item\n";
  const plan = buildChatRevealPlan(markdown);

  assert.equal(plan.chunks.join(""), markdown);
  assert.equal(plan.chunks.length, 3);
  assert.ok(plan.chunks[0]?.startsWith("- First item"));
  assert.ok(plan.chunks[1]?.startsWith("- Second item"));
  assert.ok(plan.chunks[2]?.startsWith("- Third item"));
});

test("buildChatRevealPlan keeps tables atomic and code fences incremental", () => {
  const codeMarkdown = "```ts\nconst answer = 42;\nconsole.log(answer);\n```\n";
  const codePlan = buildChatRevealPlan(codeMarkdown);

  assert.equal(codePlan.chunks.join(""), codeMarkdown);
  assert.ok(codePlan.chunks[0]?.includes("```ts"));
  assert.ok(codePlan.chunks.some((chunk) => chunk === "const answer = 42;\n"));
  assert.ok(codePlan.chunks.some((chunk) => chunk === "console.log(answer);\n"));
  assert.ok(codePlan.chunks.some((chunk) => chunk === "```\n"));

  const tableMarkdown = "| Name | Value |\n| --- | --- |\n| Speed | Fast |\n";
  const tablePlan = buildChatRevealPlan(tableMarkdown);

  assert.equal(tablePlan.chunks.join(""), tableMarkdown);
  assert.equal(tablePlan.chunks.length, 1);
  assert.equal(tablePlan.revealAtMs.length, 1);
});

test("buildChatRevealPlan no longer caps long replies near two seconds", () => {
  const markdown = "This is a longer reply with multiple sentences. ".repeat(24).trim();
  const plan = buildChatRevealPlan(markdown);

  assert.equal(plan.chunks.join(""), markdown);
  assert.ok(plan.totalDurationMs > 3200);
});
