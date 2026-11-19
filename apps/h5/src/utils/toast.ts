import { Dialog, Toast } from 'vant';

/**
 * Vant 3 的函数式反馈 API 封装。
 * Vant 3 只导出 Toast / Dialog 对象（showToast 系列是 Vant 4 的 API），
 * 页面统一从这里引入，避免各处写法分裂。
 */
export function showToast(message: string): void {
  Toast(message);
}

export function showSuccessToast(message: string): void {
  Toast.success(message);
}

export function showFailToast(message: string): void {
  Toast.fail(message);
}

export function showLoadingToast(message = '加载中…'): void {
  Toast.loading(message);
}

export function closeToast(): void {
  Toast.clear();
}

export interface DialogOptions {
  title?: string;
  message: string;
  showCancelButton?: boolean;
}

/** 确认框：确认 resolve，取消 reject（与 Vant Dialog.confirm 行为一致） */
export function showDialog(options: DialogOptions): Promise<void> {
  return Dialog.confirm({
    title: options.title,
    message: options.message,
  }).then(() => undefined);
}
