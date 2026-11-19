import { post } from './http';

/** AI 查询（第 56 节） */

export interface AiToolCall { name: string; args: Record<string, unknown>; summary: string }

export interface AiAnswer {
  answer: string;
  toolCalls: AiToolCall[];
}

export const aiQuery = (question: string) =>
  post<AiAnswer>('/ai/query', { question });
