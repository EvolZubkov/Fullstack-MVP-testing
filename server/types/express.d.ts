import { Request, Response } from "express";
import { User, Question, Test, Topic, Folder, Group, Attempt } from "@shared/schema";

// Расширение Request с userId из сессии
export interface AuthenticatedRequest extends Request {
  session: Request["session"] & {
    userId: string;
  };
}

// Типизированные параметры для роутов
export interface IdParams {
  id: string;
}

export interface TestIdParams {
  testId: string;
}

export interface AttemptIdParams {
  attemptId: string;
}

export interface TopicIdParams {
  topicId: string;
}

// Типизированные тела запросов
export interface CreateQuestionBody {
  topicId: string;
  type: "single" | "multiple" | "matching" | "ranking";
  prompt: string;
  dataJson: unknown;
  correctJson: unknown;
  points?: number;
  difficulty?: number;
  mediaUrl?: string;
  mediaType?: string;
  shuffleAnswers?: boolean;
  feedback?: string;
  feedbackMode?: string;
  feedbackCorrect?: string;
  feedbackIncorrect?: string;
}

export interface CreateTestBody {
  title: string;
  description?: string;
  mode?: "standard" | "adaptive";
  sections?: Array<{
    topicId: string;
    drawCount: number;
    topicPassRuleJson?: unknown;
  }>;
  overallPassRuleJson?: unknown;
  showCorrectAnswers?: boolean;
  timeLimitMinutes?: number;
  maxAttempts?: number;
  adaptiveSettings?: unknown;
}

export interface AnswerBody {
  questionId: string;
  answer: unknown;
}

export interface ExportExcelBody {
  testIds: string[];
  userIds?: string[];
  groupIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  bestAttemptOnly?: boolean;
  bestAttemptCriteria?: "percent" | "level_sum" | "level_count";
  includeSheets?: {
    summary?: boolean;
    attempts?: boolean;
    answers?: boolean;
    questionStats?: boolean;
    levelStats?: boolean;
    recommendations?: boolean;
  };
}

// API Response типы
export interface ApiError {
  error: string;
  code?: string;
}

export interface ApiSuccess {
  success: true;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}