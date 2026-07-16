export type TestingTaskStatus =
  | "not_started"
  | "in_progress"
  | "passed"
  | "failed"
  | "blocked";

export type TestingTaskPriority = "low" | "medium" | "high";

export type TestingTask = {
  id: string;
  title: string;
  description: string | null;
  status: TestingTaskStatus;
  priority: TestingTaskPriority;
  start_date: string;
  due_date: string | null;
  total_tc: number;
  ok_count: number;
  nok_count: number;
  na_count: number;
  total_execute_tc: number;
  total_passed_tc: number;
  created_at: string;
  updated_at: string;
};
