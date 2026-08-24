/**
 * 主题切换按钮 —— 浅色/暗色两态循环。
 * 首次点击即写入显式偏好；跟随系统是未选择时的默认行为。
 */

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { setTheme } from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  // 其他实例切换或系统变更时保持同步
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={isDark ? "切换到浅色主题" : "切换到暗色主题"}
      title={isDark ? "切换到浅色主题" : "切换到暗色主题"}
      className={className}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
