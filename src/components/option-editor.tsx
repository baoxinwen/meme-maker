import { Settings2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { type PetpetTemplate, type TemplateOptionValue, resolveTemplateOptionValues } from "@/core";
import type { TemplateOptionState } from "@/stores/meme-store";

interface OptionEditorProps {
  template: PetpetTemplate;
  values: TemplateOptionState;
  onChange: (key: string, value: TemplateOptionValue) => void;
}

export function OptionEditor({ template, values, onChange }: OptionEditorProps) {
  const resolved = resolveTemplateOptionValues(template.options, values);

  return (
    <div className="flex flex-col">
      {template.options.map((option, index) => {
        const value = resolved[option.key];
        return (
          <div key={option.key} className={index > 0 ? "border-t border-border/70 py-4" : "pb-4"}>
            {option.type === "BOOLEAN" ? (
              <label className="flex min-h-10 cursor-pointer items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Settings2 className="size-3.5" />
                  {option.label}
                </span>
                <input
                  data-testid={`template-option-${option.key}`}
                  type="checkbox"
                  checked={value === true}
                  onChange={(event) => onChange(option.key, event.target.checked)}
                  className="size-4 accent-primary"
                />
              </label>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`template-option-${option.key}`} className="text-sm">
                  {option.label}
                </Label>
                {option.type === "SELECT" && (
                  <Select
                    value={String(value)}
                    onValueChange={(next) => onChange(option.key, next)}
                  >
                    <SelectTrigger
                      id={`template-option-${option.key}`}
                      data-testid={`template-option-${option.key}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {option.choices.map((choice) => (
                        <SelectItem key={choice.value} value={choice.value}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {option.type === "NUMBER" && (
                  <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3">
                    <Slider
                      data-testid={`template-option-${option.key}`}
                      aria-label={option.label}
                      value={[Number(value)]}
                      min={option.min}
                      max={option.max}
                      step={option.step}
                      onValueChange={([next]) => onChange(option.key, next)}
                    />
                    <Input
                      id={`template-option-${option.key}`}
                      type="number"
                      value={Number(value)}
                      min={option.min}
                      max={option.max}
                      step={option.step}
                      aria-label={option.label}
                      onChange={(event) => onChange(option.key, Number(event.target.value))}
                    />
                  </div>
                )}
                {option.type === "TEXT" && (
                  <Input
                    id={`template-option-${option.key}`}
                    data-testid={`template-option-${option.key}`}
                    value={String(value)}
                    maxLength={option.maxLength}
                    placeholder={option.placeholder}
                    onChange={(event) => onChange(option.key, event.target.value)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
