/**
 * useScene —— 根据当前模板 + 头像输入 + 文字覆盖准备表情包场景。
 *
 * 这是连接核心引擎与 React 界面的核心钩子。
 */

import {
  type AvatarInputs,
  type PetpetTemplate,
  type PreparedScene,
  parseTemplate,
  prepareScene,
} from "@/core";
import { loadTemplateFonts } from "@/lib/font-loader";
import { logger } from "@/lib/logger";
import { type SceneError, toSceneError } from "@/lib/scene-error";
import { type TemplateIndexEntry, fetchTemplate } from "@/lib/template-loader";
import type { AvatarState, TemplateOptionState, TextOverride } from "@/stores/meme-store";
import { useEffect, useState } from "react";

export interface UseSceneResult {
  /** 是否正在加载（首次或重新合成时为 true） */
  loading: boolean;
  /** 错误信息（如果有）；缺头像引导态带 missingAvatar 结构 */
  error: SceneError | null;
  /** 已解析模板。即使缺少头像导致渲染失败，也会保留它供界面显示上传槽位。 */
  template: PetpetTemplate | null;
  /** 准备好的场景（只有输入齐全且渲染准备成功时才有） */
  scene: PreparedScene | null;
}

/**
 * 将文字覆盖合并进模板。
 */
export function applyTextOverrides(
  template: PetpetTemplate,
  overrides: Record<number, TextOverride>,
): PetpetTemplate {
  if (Object.keys(overrides).length === 0) return template;
  return {
    ...template,
    text: template.text.map((t, i) => {
      const ov = overrides[i];
      if (!ov) return t;
      return {
        ...t,
        ...(ov.hidden && { when: 0 }),
        ...(ov.text !== undefined && { text: ov.text }),
        ...(ov.color !== undefined && { color: ov.color }),
        ...(ov.size !== undefined && { size: ov.size }),
      };
    }),
  };
}

/**
 * 模板加载与解析阶段产出的资源（只依赖模板本身，与用户输入无关）。
 */
interface TemplateAssets {
  entryKey: string;
  parsedTemplate: PetpetTemplate;
  backgrounds: HTMLImageElement[];
  backgroundLayers: Record<string, HTMLImageElement>;
}

/**
 * useScene 钩子
 *
 * 拆成两段：模板加载/解析只依赖 entry，场景合成依赖用户输入。改文字/颜色时
 * 不会重新拉取并解析模板，既避免无谓的网络与解析开销，也保证传给界面的
 * template 引用稳定（TextEditor 列表项的 key 不会因此失效，输入框不会失焦）。
 */
export function useScene(
  entry: TemplateIndexEntry | null,
  avatars: AvatarState,
  textOverrides: Record<number, TextOverride>,
  optionValues: TemplateOptionState,
): UseSceneResult {
  const [state, setState] = useState<UseSceneResult>({
    loading: false,
    error: null,
    template: null,
    scene: null,
  });
  const [assets, setAssets] = useState<TemplateAssets | null>(null);

  // 阶段一：加载并解析模板（只依赖选中的模板，与文字/头像输入无关）。
  useEffect(() => {
    if (!entry) {
      setAssets(null);
      setState({ loading: false, error: null, template: null, scene: null });
      return;
    }

    let cancelled = false;
    setAssets(null);
    setState({ loading: true, error: null, template: null, scene: null });

    void (async () => {
      try {
        const { rawTemplate, backgrounds, backgroundLayers } = await fetchTemplate(
          entry.key,
          entry.length,
          entry.revision,
        );
        if (cancelled) return;
        const parsedTemplate = parseTemplate(rawTemplate);
        if (cancelled) return;
        // 先解析模板，让界面立即显示上传槽位；即便后续渲染失败也保留它。
        setAssets({ entryKey: entry.key, parsedTemplate, backgrounds, backgroundLayers });
        setState((s) => ({ ...s, template: parsedTemplate }));
      } catch (e) {
        if (cancelled) return;
        logger.error(`模板 ${entry.key} 加载失败`, e);
        setState({
          loading: false,
          error: toSceneError(e),
          template: null,
          scene: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry]);

  // 阶段二：合并文字覆盖并准备场景（依赖模板资源与用户输入）。
  useEffect(() => {
    if (!assets || assets.entryKey !== entry?.key) return;

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    const timer = globalThis.setTimeout(() => {
      const startedAt = performance.now();
      void (async () => {
        try {
          const { parsedTemplate, backgrounds, backgroundLayers } = assets;
          const mergedTemplate = applyTextOverrides(parsedTemplate, textOverrides);
          await loadTemplateFonts();
          if (cancelled) return;
          const inputs = buildAvatarInputs(avatars);
          const scene = await prepareScene(mergedTemplate, {
            inputs,
            backgroundImages: backgrounds,
            backgroundLayerImages: backgroundLayers,
            avatarMaskImages: backgroundLayers,
            optionValues,
          });
          if (cancelled) return;
          logger.debug(
            `场景准备完成：${entry.key} ${scene.frameCount} 帧，耗时 ${(performance.now() - startedAt).toFixed(0)}ms`,
          );
          setState({ loading: false, error: null, template: parsedTemplate, scene });
        } catch (e) {
          if (cancelled) return;
          logger.error(`场景准备失败：${entry.key}`, e);
          setState((s) => ({
            loading: false,
            error: toSceneError(e),
            template: s.template,
            scene: null,
          }));
        }
      })();
    }, 100);

    return () => {
      cancelled = true;
      globalThis.clearTimeout(timer);
    };
  }, [assets, avatars, textOverrides, optionValues, entry?.key]);

  return state;
}

function buildAvatarInputs(avatars: AvatarState): AvatarInputs {
  return {
    ...(avatars.FROM && { from: avatars.FROM }),
    ...(avatars.TO && { to: avatars.TO }),
    ...(avatars.BOT && { bot: avatars.BOT }),
    ...(avatars.GROUP && { group: avatars.GROUP }),
    ...(avatars.RANDOM && avatars.RANDOM.length > 0 && { random: avatars.RANDOM }),
    ...(avatars.USER && avatars.USER.length > 0 && { user: avatars.USER }),
  };
}
