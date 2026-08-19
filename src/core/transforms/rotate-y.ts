/**
 * 计算矩形平面绕 Y 轴旋转后的透视四边形。
 *
 * 输出顺序为左上、右上、右下、左下，并把投影包围盒重新居中到原矩形中心，
 * 便于调用方在固定舞台上保持视觉居中。
 */

type Point = readonly [number, number];
type Point3D = readonly [number, number, number];

export interface RotateYProjectionOptions {
  readonly model?: readonly [Point3D, Point3D, Point3D, Point3D];
  readonly cameraSize?: readonly [number, number];
  readonly align?: "BOUNDS_CENTER" | "MODEL_CENTER";
}

export function projectRotateY(
  width: number,
  height: number,
  angle: number,
  fov = 45,
  options: RotateYProjectionOptions = {},
): readonly [Point, Point, Point, Point] {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const [cameraWidth, cameraHeight] = options.cameraSize ?? [width, height];
  const focal = Math.hypot(cameraWidth, cameraHeight) / (2 * Math.tan((fov * Math.PI) / 360));
  const source: readonly Point3D[] = options.model ?? [
    [-width / 2, -height / 2, 0],
    [width / 2, -height / 2, 0],
    [width / 2, height / 2, 0],
    [-width / 2, height / 2, 0],
  ];

  const projected = source.map(([x, y, z]) => {
    const rotatedX = x * cos + z * sin;
    const rotatedZ = -x * sin + z * cos;
    const scale = focal / (focal - rotatedZ);
    return [rotatedX * scale, y * scale] as const;
  });

  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const alignBounds = (options.align ?? "BOUNDS_CENTER") === "BOUNDS_CENTER";
  const centerX = alignBounds ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const centerY = alignBounds ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;

  const center = ([x, y]: Point): Point => [x - centerX + width / 2, y - centerY + height / 2];
  const [leftTop, rightTop, rightBottom, leftBottom] = projected;
  return [center(leftTop), center(rightTop), center(rightBottom), center(leftBottom)];
}
