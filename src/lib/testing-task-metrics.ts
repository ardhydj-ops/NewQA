import type { TestingTask } from "@/lib/testing-task";

export type TcPercentages = {
  percentExecuted: number;
  percentPassed: number;
};

/**
 * Hitung % Execute TC dan % Passed TC dari total_tc.
 * total_tc = 0 -> 0% untuk keduanya (hindari divide-by-zero).
 */
export function computeTcPercentages(
  task: Pick<TestingTask, "total_tc" | "total_execute_tc" | "total_passed_tc">,
): TcPercentages {
  if (task.total_tc === 0) {
    return { percentExecuted: 0, percentPassed: 0 };
  }
  return {
    percentExecuted: (task.total_execute_tc / task.total_tc) * 100,
    percentPassed: (task.total_passed_tc / task.total_tc) * 100,
  };
}
