/**
 * 编辑器撤销/重做 —— 订阅 zundo temporal 副store 的响应式绑定。
 *
 * pastStates/futureStates 是数组引用，选择器只取 length 这个原始值，
 * 保证 useSyncExternalStore 的快照稳定性。
 */

import { useSyncExternalStore } from "react";

import { useEditorStore } from "@/stores/editor-store";

function useHistoryCount(selector: "pastStates" | "futureStates"): number {
  const subscribe = useEditorStore.temporal.subscribe;
  const getSnapshot = () => useEditorStore.temporal.getState()[selector].length;
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 执行撤销/重做；后台资源操作（背景导入/替换）进行中时忽略。
 *
 * zundo 的 undo/redo 不受 pause() 影响：pause 只停止快照收集，仍会弹出历史，
 * 随后完成的导入会把弹出结果覆盖掉。按钮路径靠 canUndo/canRedo 的 !busy 禁用，
 * 键盘路径必须在这里拦截（评审意见 I1）。
 */
export function performUndo(): void {
  if (useEditorStore.getState().isBackgroundOperationInProgress) return;
  useEditorStore.temporal.getState().undo();
}

export function performRedo(): void {
  if (useEditorStore.getState().isBackgroundOperationInProgress) return;
  useEditorStore.temporal.getState().redo();
}

/**
 * 清空重做栈：后台导入（pause 期间写入）完成后调用，使导入成为历史分叉点。
 * 否则导入后按重做会回到导入前旧帧，看起来像「导入丢了」（评审意见 M16）。
 */
export function clearRedoHistory(): void {
  useEditorStore.temporal.setState({ futureStates: [] });
}

export function useEditorHistory(): {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
} {
  const busy = useEditorStore((s) => s.isBackgroundOperationInProgress);
  const pastCount = useHistoryCount("pastStates");
  const futureCount = useHistoryCount("futureStates");

  return {
    canUndo: pastCount > 0 && !busy,
    canRedo: futureCount > 0 && !busy,
    undo: performUndo,
    redo: performRedo,
  };
}

/** 键盘快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做。 */
export function isUndoShortcut(event: KeyboardEvent | React.KeyboardEvent): "undo" | "redo" | null {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  return null;
}

/** 焦点在文本输入类控件里时不拦截快捷键。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
