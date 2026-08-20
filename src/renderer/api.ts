import type { PersonalToolAPI } from '../shared/types';

export function personalToolApi(): PersonalToolAPI {
  const api = (window as Window & { personalTool?: PersonalToolAPI }).personalTool;
  if (!api) {
    throw new Error('应用桥接尚未就绪，请重新启动应用。');
  }
  return api;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return '操作没有完成，请稍后再试。';
}
