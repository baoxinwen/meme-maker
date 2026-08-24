/**
 * 路由级错误兜底页 —— 替代 react-router 的默认错误屏，
 * 给出中文说明、错误详情与刷新入口，并把错误记入日志。
 */

import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";
import { useEffect, useRef } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

export function RouteErrorFallback() {
  const error = useRouteError();
  // 渲染期不做日志副作用：StrictMode 双渲染与错误页重渲染会重复记录
  const lastLogged = useRef<unknown>(null);
  useEffect(() => {
    if (lastLogged.current === error) return;
    lastLogged.current = error;
    logger.error("路由渲染出错", error);
  }, [error]);

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);

  return (
    <div className="app-shell flex min-h-dvh items-center justify-center text-foreground">
      <div className="surface-panel max-w-md rounded-lg p-6 text-center">
        <h1 className="font-display text-base font-semibold">页面出错了</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          渲染时遇到意外问题，可以尝试刷新页面重试；若反复出现请反馈错误详情。
        </p>
        <pre className="mt-3 max-h-40 overflow-auto rounded bg-muted p-2 text-left text-xs whitespace-pre-wrap">
          {message}
        </pre>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          刷新页面
        </Button>
      </div>
    </div>
  );
}
