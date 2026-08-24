/**
 * 顶层 App —— 路由 + 全局 Provider。
 *
 * 路由：
 *   /        →  MemeMakerPage（主应用）
 *   /editor  →  TemplateEditorPage（模板编辑器，懒加载）
 */

import { RouteErrorFallback } from "@/components/route-error-fallback";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MemeMakerPage } from "@/pages/meme-maker-page";
import { Suspense, lazy } from "react";
import { RouterProvider, createBrowserRouter } from "react-router-dom";

const TemplateEditorPage = lazy(() =>
  import("@/pages/template-editor-page").then((module) => ({
    default: module.TemplateEditorPage,
  })),
);

const router = createBrowserRouter([
  {
    path: "/",
    element: <MemeMakerPage />,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: "/editor",
    element: (
      <Suspense fallback={<EditorRouteFallback />}>
        <TemplateEditorPage />
      </Suspense>
    ),
    errorElement: <RouteErrorFallback />,
  },
]);

export function App() {
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster />
    </TooltipProvider>
  );
}

function EditorRouteFallback() {
  return (
    <div className="app-shell min-h-dvh text-foreground">
      <div className="container mx-auto max-w-6xl px-4 py-6">
        <div className="surface-panel rounded-lg p-5">
          <div className="font-display text-base">正在加载模板编辑器</div>
          <div className="mt-2 h-2 w-40 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}
