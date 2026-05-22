import test from "node:test";
import assert from "node:assert/strict";

import { buildRepeatedTimeWindows } from "../react-app/utils/scheduleUtils";

test("buildRepeatedTimeWindows expands a repeated sequence into normal windows", () => {
  const result = buildRepeatedTimeWindows({
    start_time: "09:00",
    duration_value: 20,
    duration_unit: "minutes",
    repeat_value: 30,
    repeat_unit: "minutes",
    occurrence_count: 4,
  });

  assert.ok(!("error" in result));
  assert.deepEqual(result.windows, [
    { start_time: "09:00:00", end_time: "09:20:00" },
    { start_time: "09:30:00", end_time: "09:50:00" },
    { start_time: "10:00:00", end_time: "10:20:00" },
    { start_time: "10:30:00", end_time: "10:50:00" },
  ]);
});

test("buildRepeatedTimeWindows rejects overlapping repeated windows", () => {
  const result = buildRepeatedTimeWindows({
    start_time: "09:00:00",
    duration_value: 45,
    duration_unit: "minutes",
    repeat_value: 30,
    repeat_unit: "minutes",
    occurrence_count: 3,
  });

  assert.deepEqual(result, {
    error: "Duration cannot be longer than the repeat interval",
  });
});

test("buildRepeatedTimeWindows rejects sequences that spill into the next day", () => {
  const result = buildRepeatedTimeWindows({
    start_time: "23:30:00",
    duration_value: 45,
    duration_unit: "minutes",
    repeat_value: 60,
    repeat_unit: "minutes",
    occurrence_count: 1,
  });

  assert.deepEqual(result, {
    error: "The generated sequence must stay within the same day",
  });
});
