import { access } from "node:fs/promises";

type AccessFile = (path: string) => Promise<void>;

/**
 * STOP文件检查必须fail-closed：
 * - 文件存在：停机；
 * - 明确ENOENT：未创建；
 * - 权限、IO或其他异常：按停机处理，绝不因无法读取而继续下单。
 */
export async function isStopFilePresent(
  path: string,
  accessFile: AccessFile = access,
): Promise<boolean> {
  try {
    await accessFile(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" &&
        "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    return true;
  }
}
